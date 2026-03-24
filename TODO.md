# Overseer – Vollständige TODO-Liste

Alles was noch fehlt, um Overseer produktionsreif und vollständig zu machen.
Stand: 2026-03-21

---

## 🔴 KRITISCH – System funktioniert nicht korrekt ohne diese

### Collector: SNMP-Checks fehlen komplett
**Datei:** `collector/cmd/main.go` – Zeile 238: `default: return unknownResult("not yet implemented")`

SNMP ist das wichtigste Protokoll für Netzwerkgeräte (Switches, Router, Firewalls).
Was implementiert werden muss:
- `snmp` – Generischer SNMP-GET (OID → Wert auslesen)
- CPU-Auslastung via SNMP (Cisco: 1.3.6.1.4.1.9.9.109.1.1.1.1.3, generisch: HOST-RESOURCES-MIB)
- RAM-Auslastung via SNMP
- Interface-Status (up/down) per OID
- Interface-Auslastung (Bytes in/out)
- Disk-Auslastung via HOST-RESOURCES-MIB (für SNMP-fähige Geräte)
- Toner-/Druckerstatus via Printer-MIB

Go-Library: `github.com/gosnmp/gosnmp`

### Collector: SSH-Checks fehlen komplett
**Datei:** `collector/cmd/main.go` – Zeile 238

Für Linux-Server ohne SNMP-Agent:
- `ssh_disk` – `df -h` ausgabe parsen → Disk-Nutzung in %
- `ssh_cpu` – `top -bn1` oder `/proc/stat` → CPU in %
- `ssh_mem` – `/proc/meminfo` → RAM in %
- `ssh_process` – Prüfen ob Prozess läuft (z.B. nginx, postgresql)
- `ssh_service` – systemctl is-active <service>
- `ssh_custom` – Beliebiges Kommando ausführen, Exit-Code auswerten

Go-Library: `golang.org/x/crypto/ssh`

### Collector: Threshold-Auswertung fehlt
**Problem:** Der Collector sendet Check-Werte (z.B. CPU=87%), aber bestimmt den Status
(OK/WARNING/CRITICAL) selbst – ohne die konfigurierten Schwellwerte vom Server zu kennen.

Der Worker übernimmt den Status blind vom Collector.

**Was fehlen muss:**
- Config-API muss `threshold_warn` und `threshold_crit` pro Service zurückgeben
- Collector muss diese Werte speichern und beim Check anwenden:
  `if value >= threshold_crit → CRITICAL, >= threshold_warn → WARNING`
- Aktuell stehen Schwellwerte in der DB aber werden nirgendwo ausgewertet

### Collector: Heartbeat / last_seen_at fehlt
**Problem:** Der Server weiß nicht ob ein Collector noch läuft oder ausgefallen ist.

Was fehlen muss:
- Collector sendet regelmäßig `PATCH /api/v1/collectors/{id}/heartbeat`
- API aktualisiert `last_seen_at` in der DB
- Worker oder Cronjob erkennt: Collector seit > 2× Intervall nicht gemeldet → alle seine
  Services auf UNKNOWN setzen (Dead Collector Detection)
- Frontend zeigt "Collector offline" Badge

### Worker: State-History-Bug
**Datei:** `worker/app/main.py` Zeile ~332
```python
state_type = new_state_type if "new_state_type" in dir() else "SOFT"
```
Variable ist immer im Scope → funktioniert zufällig, aber nicht korrekt strukturiert.
Sauber mit explizitem `previous_state_type` aus DB-Zeile arbeiten.

---

## 🟠 WICHTIG – Kernfunktionen die für den Produktionsbetrieb nötig sind

### Admin-UI: Host-CRUD
Aktuell können Hosts nur via Seed-Script oder direkt per SQL angelegt werden.

**Backend fehlt:**
- `POST /api/v1/hosts/` – Host anlegen (tenant_id, collector_id, hostname, ip, type)
- `PUT /api/v1/hosts/{id}` – Host bearbeiten
- `DELETE /api/v1/hosts/{id}` – Host deaktivieren (soft delete: `active=false`)

**Frontend fehlt:**
- "Host anlegen"-Button auf Hosts-Seite → Modal mit Formular
- Inline-Edit in Host-Detailseite
- Deaktivieren-Button

### Admin-UI: Service/Check-CRUD
**Backend fehlt:**
- `POST /api/v1/services/` – Check anlegen (host_id, name, check_type, config, thresholds)
- `PUT /api/v1/services/{id}` – Check bearbeiten (Schwellwerte, Intervall, max_attempts)
- `DELETE /api/v1/services/{id}` – Check deaktivieren

**Frontend fehlt:**
- Check-Liste in Host-Detailseite mit "Hinzufügen"-Button
- Modal: Check-Typ wählen, config-Felder dynamisch je nach Typ (ping → keine Config,
  port → port-Nummer, http → URL, snmp → OID, ssh → Kommando)

### Admin-UI: Tenant-CRUD
**Backend fehlt:**
- `POST /api/v1/tenants/` – Tenant anlegen
- `PUT /api/v1/tenants/{id}` – Tenant umbenennen, deaktivieren
- API-Key generieren: `POST /api/v1/tenants/{id}/api-keys` → generiert neuen Key,
  zeigt ihn einmalig im Klartext

**Frontend fehlt:**
- "Tenant anlegen"-Button auf Tenants-Seite
- API-Key-Generator-Modal (zeigt Key einmalig, dann nie wieder)

### Admin-UI: User-/Rechteverwaltung
**Backend fehlt:**
- `GET /api/v1/users/` – Benutzer auflisten
- `POST /api/v1/users/` – Benutzer anlegen (email, password, role, tenant_id)
- `PUT /api/v1/users/{id}` – Rolle ändern, deaktivieren
- `DELETE /api/v1/users/{id}` – Deaktivieren
- `POST /api/v1/users/{id}/password` – Passwort setzen/ändern

**Frontend fehlt:**
- Eigene Seite `/users` (nur super_admin)
- Tabelle mit Benutzern, Rolle, letzter Login
- Modal: Benutzer anlegen / Rolle zuweisen

### Rollenbasierte Zugriffskontrolle (RBAC) wird nicht durchgesetzt
**Problem:** JWT enthält die Rolle (`super_admin`, `tenant_admin`, etc.), aber die API-Endpunkte
prüfen sie nicht. Ein `tenant_viewer` kann aktuell ACKs setzen, Downtimes anlegen und alle
Tenants sehen.

**Was fehlen muss:**
- `require_role("super_admin")` Dependency für Admin-Endpunkte
- Tenant-Scoping: `tenant_admin` darf nur eigenen Tenant sehen/bearbeiten
- `tenant_viewer` darf nichts schreiben (nur lesen)
- `tenant_operator` darf ACK/Downtime, aber kein CRUD

### Collector: Kein Installations-/Setup-Workflow
Aktuell muss ein Collector manuell in der DB angelegt werden.

**Was fehlen muss:**
- `POST /api/v1/collectors/` – Collector anlegen, API-Key zurückgeben
- Collector-Setup-Script (`install.sh`): lädt Binary, legt systemd-Service an, schreibt config
- Systemd-Unit-File: `overseer-collector.service`
- Konfigurationsdatei statt nur Env-Vars: `/etc/overseer/collector.conf`

---

## 🟡 SOLLTE VORHANDEN SEIN – Für sinnvollen Betrieb

### Verlaufs-/History-Daten im Frontend
TimescaleDB speichert `check_results` als Zeitreihe – aber es gibt keine UI dafür.

**Backend fehlt:**
- `GET /api/v1/history/{service_id}?from=&to=` – Zeitreihe für einen Check
- `GET /api/v1/history/{service_id}/summary` – Min/Max/Avg für Zeitraum

**Frontend fehlt:**
- Sparkline/Graph in Host-Detailseite (z.B. CPU der letzten 24h)
- Klick auf Service → History-Modal mit Chart
- Library: `recharts` oder `chart.js`

### Downtime-Verwaltung
Aktuell können Downtimes angelegt werden, aber nicht verwaltet.

**Backend fehlt:**
- `GET /api/v1/downtimes/` gibt bereits aktive Downtimes zurück ✅
- `GET /api/v1/downtimes/?include_past=true` – Vergangene Downtimes
- Cron/Background-Task: Downtimes die abgelaufen sind automatisch deaktivieren
  (aktuell: `in_downtime`-Flag wird nie automatisch zurückgesetzt wenn Downtime endet)

**Frontend fehlt:**
- Eigene Seite `/downtimes` – Liste aller aktiven/vergangenen Downtimes
- Downtime löschen/beenden
- Downtime für ganzen Host (nicht nur einzelne Services)

### ACK: Wer hat acknowledged?
**Problem:** `acknowledged_by` wird in der DB nie gesetzt (status.py Zeile 201).
Der Worker setzt es auf `None`, die API setzt es nicht.

**Fix:**
- `POST /acknowledge/{service_id}` → User aus JWT auslesen → in `acknowledged_by` speichern
- In Fehlerübersicht anzeigen: "ACK von max.mustermann"

### Auth: Token-Refresh
**Problem:** Token läuft nach 8h ab → Benutzer wird ausgeloggt ohne Warnung.

**Backend fehlt:**
- `POST /api/v1/auth/refresh` – Gibt neues Token wenn altes noch gültig
- `POST /api/v1/auth/logout` – Client-seitig Token löschen reicht, aber serverseitig
  könnte eine Blacklist geführt werden (optional)

**Frontend fehlt:**
- Axios-Interceptor: bei 401 → Token-Refresh versuchen, bei Fehler → Login
- Automatischer Refresh 10min vor Ablauf

### Auth: /me Endpoint
`GET /api/v1/auth/me` gibt aktuell nur `{"status": "ok"}` zurück.

**Fix:** Echte User-Daten aus DB zurückgeben (email, display_name, role, tenant_id)

### Frontend: Logout-Button
Aktuell gibt es keine Möglichkeit sich auszuloggen.

**Fix:**
- Logout-Button im Sidebar-Footer
- Löscht `overseer_token` aus localStorage, reloaded Seite

### Frontend: Fehlerübersicht – Filtern & Suchen
- Filterbar nach Tenant (Dropdown)
- Filterbar nach Status (CRITICAL/WARNING/UNKNOWN)
- Suchfeld (Hostname, Service-Name)
- URL-Parameter werden bereits per `?tenant_id=...` vom Dashboard gesetzt, aber
  die Fehlerübersicht liest sie nicht aus und filtert nicht

### Frontend: Pagination
Alle Listen (Hosts, Errors, etc.) laden ungepaginiert alle Einträge.
Bei 500+ Hosts wird das ein Problem.

**Backend:** `limit` + `offset` Query-Parameter zu allen List-Endpunkten
**Frontend:** Einfache Pagination oder Infinite-Scroll

### TimescaleDB: Retention Policy
`check_results` wächst unbegrenzt. Bei 43 Checks × 60s Intervall = ~62.000 Rows/Tag.

**Fix in Migration oder separatem Script:**
```sql
SELECT add_retention_policy('check_results', INTERVAL '90 days');
SELECT add_compression_policy('check_results', INTERVAL '7 days');
```

---

## 🔵 NICE TO HAVE – Qualität & Produktionsreife

### Tests fehlen komplett
Es gibt keine einzige Testdatei im ganzen Projekt.

**Minimum:**
- `api/tests/test_auth.py` – Login, ungültiges Passwort, abgelaufenes Token
- `api/tests/test_status.py` – Error-Overview, Summary
- `worker/tests/test_state_logic.py` – Soft→Hard Transition, Reset bei OK
- `collector/cmd/main_test.go` – Ping-Check, Port-Check, HTTP-Check

### Collector: Config Hot-Reload
Aktuell muss Collector neu gestartet werden wenn sich die Config ändert.

**Fix:** Periodisch (z.B. alle 5min) neue Config vom Server holen und anwenden,
ohne laufende Checks zu unterbrechen.

### Collector: Structured Logging
Aktuell `log.Printf(...)` – schwer zu parsen.

**Fix:** `slog` (Go 1.21+) mit JSON-Output für Produktion, Text für Entwicklung.

### Collector: Eigenständige Registrierung
**Fix:** Wenn `OVERSEER_COLLECTOR_ID` nicht gesetzt → Collector registriert sich selbst
via `POST /api/v1/collectors/register` mit API-Key → erhält UUID zurück → speichert lokal.

### Worker: Dead Letter Queue
Wenn eine Nachricht aus dem Redis-Stream nicht verarbeitbar ist (z.B. unbekannter Hostname),
wird sie aktuell still ignoriert.

**Fix:** Nach N Retries → in separaten Redis-Stream `overseer:dead-letters` verschieben.
Admin kann diese einsehen und manuell behandeln.

### Worker: Benachrichtigungen bei State-Änderungen (optional)
Laut Spec kein Alerting – aber ein Webhook-System wäre nützlich:
- Bei Übergang SOFT→HARD: Webhook-URL aufrufen (konfigurierbar pro Tenant)
- Payload: host, service, status, message
- Einfacher als Email, integrierbar mit Slack/Teams/PagerDuty

### API: Rate Limiting
Der Receiver-Endpunkt (`POST /api/v1/results`) ist ohne Rate-Limit.
Ein fehlerhafter Collector könnte den Server fluten.

**Fix:** `slowapi` Library, z.B. max 100 req/min pro API-Key.

### API: Pagination für alle List-Endpunkte
Bereits unter "Sollte vorhanden sein" erwähnt.

### Docker: Produktions-Compose
Aktuell `docker-compose.yml` für Dev (exposed Ports, kein HTTPS).

**Fehlt:** `docker-compose.prod.yml` mit:
- Keine direkt exponierten DB/Redis-Ports
- Nginx als Reverse-Proxy für API + Frontend
- SSL-Terminierung (Let's Encrypt via certbot oder traefik)
- Proper Secret-Management (`.env.secret` oder Docker Secrets)

### .env.example
Fehlt komplett. Welche Env-Vars braucht man?

```
DATABASE_URL=postgresql+asyncpg://overseer:PASSWORD@localhost:5432/overseer
REDIS_URL=redis://localhost:6379
SECRET_KEY=change_this_in_production_min_32_chars
OVERSEER_API_URL=https://overseer.example.com
OVERSEER_RECEIVER_URL=https://overseer.example.com
OVERSEER_API_KEY=overseer_tenant_XXXXXX
OVERSEER_COLLECTOR_ID=uuid-here
```

### README.md – Einrichtungsanleitung
Aktuell gibt es nur CLAUDE.md (für KI) und PLAN.md (für Implementierung).

**Fehlt:** README.md mit:
- Was ist Overseer?
- Voraussetzungen (Docker, Go 1.22+, Python 3.12+)
- Schnellstart (docker compose up + seed)
- Collector einrichten (Binary bauen, Env-Vars setzen, systemd)
- Erstes Login
- Architektur-Diagramm

### Collector: Mehr HTTP-Check-Optionen
Aktuell: nur GET, kein TLS-Verify-Kontrolle.

**Fehlt:**
- `verify_ssl: false` Config-Option
- Custom HTTP-Header (z.B. für Auth)
- Response-Body-Matching (enthält "OK"?)
- POST-Requests
- Timeout konfigurierbar

### Frontend: Mobile-Responsiveness
Aktuell feste Sidebar, nicht nutzbar auf Mobilgeräten.
Sidebar sollte auf kleinen Screens ein Hamburger-Menü werden.

### Frontend: Status-History pro Service
In Host-Detailseite: "Wann war dieser Check zuletzt CRITICAL?" – aktuell nicht sichtbar.

### Audit-Log
Wer hat wann was gemacht? (ACK gesetzt, Downtime angelegt, Host angelegt)
Tabelle `audit_log` mit actor_id, action, target_type, target_id, payload, created_at.

---

## Zusammenfassung nach Priorität

| # | Was | Priorität |
|---|-----|-----------|
| 1 | SNMP-Checks im Collector | 🔴 Kritisch |
| 2 | SSH-Checks im Collector | 🔴 Kritisch |
| 3 | Threshold-Auswertung im Collector | 🔴 Kritisch |
| 4 | Heartbeat + Dead-Collector-Detection | 🔴 Kritisch |
| 5 | Host-CRUD (Backend + Frontend) | 🟠 Wichtig |
| 6 | Service/Check-CRUD (Backend + Frontend) | 🟠 Wichtig |
| 7 | Tenant-CRUD + API-Key-Generator | 🟠 Wichtig |
| 8 | User-Verwaltung + RBAC durchsetzen | 🟠 Wichtig |
| 9 | Collector Install-Script + systemd | 🟠 Wichtig |
| 10 | Downtime auto-expire + Verwaltungs-Seite | 🟡 Sollte |
| 11 | ACK: acknowledged_by befüllen | 🟡 Sollte |
| 12 | Token-Refresh + Logout | 🟡 Sollte |
| 13 | Fehlerübersicht: Filter + Suche | 🟡 Sollte |
| 14 | TimescaleDB Retention Policy | 🟡 Sollte |
| 15 | History-Graphen im Frontend | 🟡 Sollte |
| 16 | Tests (minimal) | 🔵 Nice to have |
| 17 | Collector Config Hot-Reload | 🔵 Nice to have |
| 18 | .env.example + README.md | 🔵 Nice to have |
| 19 | Produktions-Docker-Compose (HTTPS) | 🔵 Nice to have |
| 20 | Pagination + Rate Limiting | 🔵 Nice to have |
