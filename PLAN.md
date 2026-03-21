# Overseer – Implementierungsplan

Jeder Schritt endet mit einem klaren Test. Nie zum nächsten Schritt ohne bestandenen Test.
Arbeitsverzeichnis immer: `/home/lukas/Documents/Projects/Overseer/overseer/`

---

## Phase 1 – Backend absichern & vervollständigen

### Schritt 1.1 – JWT Auth-Middleware
**Ziel:** Alle API-Endpunkte außer `/health` und `/api/v1/auth/login` verlangen einen gültigen JWT.
Erstelle `api/app/core/auth.py` mit einer `get_current_user` Dependency (python-jose, liest `Authorization: Bearer <token>` Header). Binde sie in alle Router als `Depends(get_current_user)` ein. `/health` und `/login` bleiben offen.

**Test (curl):**
```bash
# Ohne Token → 401
curl -s http://localhost:8000/api/v1/status/summary | python3 -m json.tool
# Mit Token → Daten
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"admin@overseer.local","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/status/summary | python3 -m json.tool
```
Frontend muss weiterhin funktionieren (Token wird bereits mitgeschickt).

---

### Schritt 1.2 – Receiver: echte API-Key-Validierung aus DB
**Ziel:** `receiver/app/main.py` → `validate_api_key()` ersetzt Format-Check durch echten DB-Lookup.
Installiere `asyncpg` + `sqlalchemy[asyncio]` im Receiver. Lookup: `SELECT tenant_id FROM api_keys WHERE key_prefix = :prefix AND active = true`, dann `sha256(api_key) == key_hash` vergleichen. Bei Treffer `last_used_at` updaten.

**Test (curl):**
```bash
# Mit echtem Seed-Key (Key aus seed_dev_data.py Output) → 202
curl -s -X POST http://localhost:8001/api/v1/results \
  -H "X-API-Key: overseer_mueller-gmbh_XXXXX" \
  -H "Content-Type: application/json" \
  -d '{"collector_id":"test","tenant_id":"mueller-gmbh","timestamp":"2026-01-01T00:00:00Z","checks":[]}'
# Mit falschem Key → 401
curl -s -X POST http://localhost:8001/api/v1/results \
  -H "X-API-Key: invalid_key" \
  -H "Content-Type: application/json" \
  -d '{"collector_id":"test","tenant_id":"x","timestamp":"2026-01-01T00:00:00Z","checks":[]}'
```
Receiver muss vorher gestartet sein: `PYTHONPATH=. uvicorn receiver.app.main:app --port 8001`

---

### Schritt 1.3 – Config-API: echte Daten für Collector
**Ziel:** `GET /api/v1/config/collector/{collector_id}` gibt echte Host+Service-Liste aus DB zurück.
Format:
```json
{
  "collector_id": "...",
  "interval_seconds": 60,
  "hosts": [
    {
      "hostname": "switch-core-01",
      "ip_address": "192.168.1.1",
      "checks": [
        {"name": "ping", "type": "ping", "config": {}},
        {"name": "cpu_usage", "type": "snmp", "config": {"oid": "..."}}
      ]
    }
  ]
}
```
Query: JOIN collectors → hosts → services WHERE collector_id = :id AND hosts.active AND services.active.

**Test (curl):**
```bash
TOKEN=... # wie oben
# Collector-ID aus DB holen
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/collectors/ | python3 -m json.tool | grep '"id"' | head -1
# Config abrufen
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/config/collector/<ID> | python3 -m json.tool
# Erwartung: hosts-Array mit mindestens 1 Host und Checks
```

---

## Phase 2 – Collector vervollständigen (Go)

### Schritt 2.1 – Config-Pull vom Server
**Ziel:** `collector/cmd/main.go` holt beim Start die Config von `GET /api/v1/config/collector/{collector_id}` (HTTP mit API-Key-Header). Struktur-Typen für die Config-Response anlegen. Main-Loop iteriert über `config.Hosts` statt Hardcode `localhost`.

**Test:**
```bash
cd collector
go build -o overseer-collector ./cmd/
# Mit einem echten Collector-Key aus dem Seed starten
OVERSEER_API_URL=http://localhost:8000 \
OVERSEER_API_KEY=overseer_mueller-gmbh_XXXXX \
OVERSEER_COLLECTOR_ID=<collector_uuid> \
./overseer-collector
# Erwartung: Log zeigt "Loaded config: X hosts, Y checks"
```

---

### Schritt 2.2 – Ping-Check (echter OS-Ping)
**Ziel:** `doPingCheck()` in `collector/cmd/main.go` führt echten `ping -c 1 -W 2 <host>` Befehl aus (exec.Command), parst RTT aus Output, setzt Status OK/CRITICAL. Timeout 3s.

**Test:**
```bash
# Collector läuft (aus 2.1), nach einem Intervall im Log:
# "CHECK host=switch-core-01 check=ping status=OK value=1.2ms"
# Für nicht-erreichbaren Host: status=CRITICAL
```

---

### Schritt 2.3 – HTTP-Check
**Ziel:** `doHTTPCheck()` macht GET auf `check_config.url`, misst Response-Zeit, prüft Status-Code (2xx = OK, sonst CRITICAL). Timeout 10s, TLS-Verify konfigurierbar.

**Test:**
```bash
# Im Log nach Intervall:
# "CHECK host=srv-app-01 check=webapp_http status=OK value=45ms"
```

---

### Schritt 2.4 – Port-Check
**Ziel:** `doPortCheck()` versucht TCP-Connect zu `host:port`, misst Verbindungszeit. Timeout 5s. OK wenn connect erfolgreich, CRITICAL sonst.

**Test:**
```bash
# Im Log:
# "CHECK host=srv-dc-01 check=rdp_port status=OK value=12ms"
```

---

### Schritt 2.5 – Collector sendet an Receiver + Worker verarbeitet
**Ziel:** End-to-End-Test. Collector läuft, sendet an `POST http://localhost:8001/api/v1/results`, Worker (falls noch nicht läuft, starten) verarbeitet. Danach sollten frische `last_check_at`-Timestamps in der DB stehen.

**Test (DB-Query + API):**
```bash
# Worker starten: PYTHONPATH=. python3 -m worker.app.main
# Collector 1 Intervall laufen lassen
# Dann:
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/status/summary
# last_check_at sollte jetzt aktuell sein:
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/v1/status/errors" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['last_check_at'] if d else 'no errors')"
```

---

## Phase 3 – Frontend ausbauen

### Schritt 3.1 – Acknowledge-Button in Fehlerübersicht
**Ziel:** In `ErrorOverviewPage.tsx` bekommt jede Zeile einen "ACK"-Button (wenn nicht acknowledged) bzw. "Un-ACK"-Button (wenn acknowledged). POST/DELETE auf `/api/v1/status/acknowledge/{service_id}`. Nach Klick wird die Liste neu geladen (React Query `invalidateQueries`).

**Test (Browser):**
- Fehlerübersicht öffnen
- ACK-Button klicken → Zeile bekommt blaues "ACK"-Badge
- Browser-Refresh → ACK-Status bleibt
- Un-ACK klicken → Badge verschwindet

---

### Schritt 3.2 – Host-Detailseite
**Ziel:** `HostDetailPage.tsx` zeigt für einen Host:
- Header: Hostname, Display-Name, IP, Typ-Icon, Tenant-Name
- Tabelle aller Services mit aktuellem Status (Farb-Badge), letzter Check-Zeit, Status-Message, Value+Unit
- Status-Farben: CRITICAL=rot, WARNING=gelb, OK=grün, UNKNOWN=grau

API-Calls: `GET /api/v1/hosts/{host_id}` + `GET /api/v1/status/host/{host_id}`

**Test (Browser):**
- In Fehlerübersicht auf Hostname klicken (Link zu `/hosts/{id}` hinzufügen)
- Detailseite öffnet sich mit Host-Info und Service-Tabelle
- Alle Services sichtbar, Status-Badges korrekt eingefärbt

---

### Schritt 3.3 – Dashboard: Per-Tenant-Tabelle
**Ziel:** Unterhalb der Summary-Cards in `DashboardPage.tsx` eine Tabelle: eine Zeile pro Tenant mit OK/WARNING/CRITICAL/UNKNOWN-Zahlen und farbigen Balken (Mini-Bar-Chart mit div-Breiten).

Neuer API-Endpunkt: `GET /api/v1/status/summary/by-tenant` → gibt Array zurück:
```json
[{"tenant_id": "...", "tenant_name": "Müller GmbH", "ok": 38, "warning": 1, "critical": 2, "unknown": 0}]
```

**Test (Browser + curl):**
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/status/summary/by-tenant | python3 -m json.tool
```
Im Browser: Tabelle unter den Cards sichtbar, Zahlen stimmen mit Summary überein.

---

### Schritt 3.4 – Auto-Refresh
**Ziel:** Dashboard und Fehlerübersicht aktualisieren sich automatisch alle 10 Sekunden ohne manuellen Reload. React Query `refetchInterval: 10000` setzen. Kleiner "Zuletzt aktualisiert: vor X Sek"-Counter in der UI.

**Test (Browser):**
- Fehlerübersicht offen lassen
- In einem zweiten Terminal: ACK setzen via curl
- Nach max. 10 Sekunden erscheint das ACK-Badge automatisch

---

### Schritt 3.5 – Downtime-Dialog
**Ziel:** In der Fehlerübersicht bekommt jede Zeile einen "Downtime"-Button. Öffnet ein Modal mit Start/End-Datetime-Picker und Kommentarfeld. POST auf `POST /api/v1/downtimes/` (neuer Endpoint im Backend). Aktive Downtimes werden in der Übersicht mit grauem Badge markiert.

Neuer API-Endpunkt: `POST /api/v1/downtimes/` mit Body `{host_id?, service_id?, start_at, end_at, comment}`.

**Test (Browser):**
- Downtime-Button klicken → Modal öffnet sich
- Zeitraum eintragen, speichern
- Zeile bekommt "Downtime"-Badge
- Mit `include_downtime=false` (default) verschwindet die Zeile

---

## Phase 4 – Verwaltungs-UI

### Schritt 4.1 – Hosts-Seite
**Ziel:** Neue Seite `/hosts` in der Sidebar. Tabelle aller Hosts (alle Tenants für Super-Admin): Hostname, Display-Name, IP, Typ-Icon, Tenant, Collector, letzter Check-Status (Ampel-Dot). Klick auf Zeile → Host-Detailseite (aus 3.2).

**Test (Browser):**
- "Hosts" in Sidebar erscheint
- Tabelle zeigt alle 14 Seed-Hosts
- Klick auf Zeile öffnet Detailseite

---

### Schritt 4.2 – Tenants-Seite (Super-Admin)
**Ziel:** Neue Seite `/tenants` (nur sichtbar wenn `role == super_admin` im JWT). Zeigt alle Tenants mit Statistik: Anzahl Hosts, Anzahl Checks, aktive Probleme. Klick zeigt Tenant-Detail mit seinen Collectors + API-Keys (Key nur als Prefix, nicht voll).

**Test (Browser):**
- Als Super-Admin: "Tenants" in Sidebar sichtbar
- Tenant-Liste mit Zahlen
- Als normaler Tenant-User: Sidebar-Item nicht sichtbar (JWT-Rolle prüfen)

---

## Phase 5 – Production-Ready

### Schritt 5.1 – Docker Compose: alle Services
**Ziel:** `docker-compose.yml` so vervollständigen dass `docker compose up` alle 5 Services startet (postgres, redis, receiver, worker, api, frontend). Receiver und Worker benötigen korrekte Import-Pfade (wie API). Seed-Script wird als `docker compose run --rm api python3 scripts/seed_dev_data.py` ausführbar.

**Test:**
```bash
docker compose up -d
sleep 15
docker compose ps  # alle 6 Container "healthy" oder "running"
curl http://localhost:8000/health
curl http://localhost:3000  # Frontend über Nginx
```

---

### Schritt 5.2 – Passwort-Hashing im Seed
**Ziel:** `scripts/seed_dev_data.py` generiert echten bcrypt-Hash für "admin123" via `passlib` statt Placeholder-String. Damit funktioniert auch passlib-`verify()` im Auth-Router.

**Test:**
```bash
python3 scripts/seed_dev_data.py  # Re-seed (oder separates reset-Script)
# Login mit admin123 muss weiterhin funktionieren
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@overseer.local","password":"admin123"}'
# → access_token vorhanden, kein 401
```

---

### Schritt 5.3 – GitHub Push & finales Commit
**Ziel:** Alle Änderungen committen und auf GitHub pushen. CLAUDE.md und README.md aktualisieren (Status: was ist fertig, was läuft wie). `.env.example` mit allen nötigen Variablen vervollständigen.

**Test:**
```bash
git log --oneline -10
# GitHub: https://github.com/lukas5001/Overseer → alle Dateien aktuell
```

---

## Reihenfolge-Zusammenfassung

```
1.1 Auth-Middleware     → curl-Test
1.2 Receiver DB-Lookup  → curl-Test
1.3 Config-API          → curl-Test
2.1 Collector Config    → go build + Log
2.2 Ping-Check          → Log
2.3 HTTP-Check          → Log
2.4 Port-Check          → Log
2.5 End-to-End Test     → API-Query
3.1 ACK-Button          → Browser
3.2 Host-Detailseite    → Browser
3.3 Tenant-Tabelle      → Browser + curl
3.4 Auto-Refresh        → Browser
3.5 Downtime-Dialog     → Browser
4.1 Hosts-Seite         → Browser
4.2 Tenants-Seite       → Browser
5.1 Docker Compose      → docker compose up
5.2 Passwort-Hashing    → curl Login-Test
5.3 GitHub Push         → git log
```

**Gesamtaufwand-Schätzung:** 16 Schritte, je 15–45 Minuten = 6–10 Stunden Implementierung.
