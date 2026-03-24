# Overseer – Projektanalyse

Stand: 2026-03-22

## 1. Architektur-Bewertung

### Stärken
- Saubere Trennung: Receiver → Redis → Worker Pipeline funktioniert gut für Push-basiertes Monitoring
- Multi-Tenant-Isolation auf DB-Ebene konsequent durchgezogen
- Active + Passive Check-Modi decken beide Anwendungsfälle ab
- Shared Schemas (Pydantic) vermeiden Duplizierung zwischen API/Worker/Receiver
- TimescaleDB für Zeitreihen-Daten ist die richtige Wahl

### Schwächen
- Keine automatisierten Tests (< 15% Coverage geschätzt)
- Keine Datenbank-Backups konfiguriert
- Kein Self-Monitoring (Overseer überwacht sich nicht selbst)
- Go-Collector implementiert nur 3 von 9+ Check-Typen


## 2. Backend – Kritische Issues

### 2.1 `datetime.utcnow()` (deprecated seit Python 3.12)
Mehrere Stellen nutzen `datetime.utcnow()` statt `datetime.now(timezone.utc)`. Python 3.12 markiert das als deprecated, und es erzeugt naive datetimes ohne Timezone-Info.

**Betroffene Dateien:**
- `api/app/routers/*.py` (diverse Router)
- `worker/app/*.py`
- `shared/checker.py`

### 2.2 Fehlende Pagination
Mehrere List-Endpoints liefern alle Ergebnisse ohne Limit:
- `GET /services/` – kein Limit/Offset
- `GET /tenants/` – kein Limit/Offset
- `GET /state-history/` – kein Limit/Offset
- `GET /check-results/` – nur time-basiert gefiltert, kein Limit

Bei wachsender Datenmenge wird das zum Performance-Problem.

### 2.3 Fehlende Audit-Logs
Nur `host_create` wird geloggt. Folgende Aktionen haben keinen Audit-Trail:
- Service erstellen/ändern/löschen
- Tenant erstellen/ändern/löschen
- User erstellen/ändern/löschen
- Host ändern/löschen
- Downtime erstellen/löschen
- Acknowledgements

### 2.4 Race Conditions im Worker
`current_status` Updates sind nicht atomar – bei mehreren Worker-Instanzen können sich Ergebnisse überschreiben. Das `SELECT` + `UPDATE` Pattern hat ein TOCTOU-Problem (Time-of-Check-Time-of-Use).

### 2.5 Hardcoded Secrets
- Redis-URL und DB-Connection-Strings teilweise hardcoded statt über Environment-Variablen
- ~~WinRM wurde entfernt (ersetzt durch Agent-basiertes Monitoring)~~


## 3. Frontend – Kritische Issues

### 3.1 Überdimensionierte Komponenten
- `ErrorOverviewPage.tsx` – 31+ useState Hooks, 1400+ Zeilen
- `HostDetailPage.tsx` – 1000+ Zeilen, Inline-Modals
- Keine wiederverwendbaren UI-Komponenten (StatusBadge, DataTable, Modal, etc.)

### 3.2 Fehlende Error Boundaries
Kein React Error Boundary implementiert. Ein JS-Fehler in einer Komponente crasht die gesamte App.

### 3.3 Keine 404-Route
Ungültige URLs zeigen eine leere Seite statt einer Fehlermeldung.

### 3.4 Kein Accessibility (a11y)
- Fehlende aria-Labels
- Keine Keyboard-Navigation in Tabellen
- Fehlende Screen-Reader-Unterstützung

### 3.5 Performance
- Keine virtualisierte Listen für große Datensätze
- Polling-Intervalle nicht konfigurierbar
- Kein Debouncing bei Suchfeldern


## 4. Infrastruktur

### 4.1 Keine Datenbank-Backups
Kein pg_dump Cronjob oder WAL-Archiving konfiguriert. Datenverlust bei Ausfall.

### 4.2 Kein Self-Monitoring
Overseer überwacht sich selbst nicht:
- Kein Health-Check für API/Receiver/Worker
- Kein Monitoring der Redis-Queue-Tiefe
- Kein Alarm bei Worker-Ausfall

### 4.3 Migrations-System
`scripts/migrate.py` hat kein Rollback und kein Tracking welche Migrations bereits gelaufen sind (außer via Dateiname-Konvention).

### 4.4 Go-Collector unvollständig
Implementiert nur: `ping`, `http`, `snmp`. Fehlend: `tcp`, `dns`, `ssh`, `snmp_interface`, `certificate`. WinRM-Typen entfernt (ersetzt durch Agent).


## 5. Sicherheit

### 5.1 ~~WinRM~~ — Entfernt
WinRM wurde komplett entfernt und durch Agent-basiertes Monitoring ersetzt.

### 5.2 SNMP Community Strings
SNMP Community Strings sind mittlerweile AES-256-GCM-verschlüsselt.

### 5.3 Keine Rate-Limiting
API-Endpoints haben kein Rate-Limiting. DoS-Angriffe möglich.

### 5.4 JWT Token Expiry
Token-Expiry und Refresh-Logik sollte überprüft werden.


## 6. Code-Qualität

### 6.1 Duplizierung
- ~~WinRM entfernt~~ — SNMP-Credential-Injection ist zentralisiert in `shared/status.py`
- Status-Update-Logik (Soft/Hard State Machine) zweifach dupliziert (scheduler.py, services.py check-now)
- Check-Typ-Listen im Frontend und Backend nicht synchron

### 6.2 Typ-Sicherheit
- Viele `dict`-Rückgaben statt typisierter Pydantic-Models
- Frontend TypeScript-Interfaces manuell statt generiert

### 6.3 Logging
- Inkonsistente Logger-Namen
- Kein strukturiertes Logging (JSON)
- Fehlende Request-IDs für Tracing


## 7. Prioritäts-Matrix

| Priorität | Issue | Aufwand |
|-----------|-------|---------|
| KRITISCH | DB-Backups einrichten | Klein |
| KRITISCH | datetime.utcnow() ersetzen | Klein |
| HOCH | Error Boundaries im Frontend | Klein |
| HOCH | 404-Route hinzufügen | Klein |
| HOCH | Status-Update-Logik deduplizieren | Mittel |
| HOCH | Pagination für alle List-Endpoints | Mittel |
| MITTEL | Audit-Logging erweitern | Mittel |
| ~~MITTEL~~ | ~~WinRM entfernt~~ | ~~Erledigt~~ |
| MITTEL | Reusable UI-Komponenten extrahieren | Groß |
| NIEDRIG | Rate-Limiting | Mittel |
| NIEDRIG | Strukturiertes Logging | Mittel |
| NIEDRIG | Credential-Verschlüsselung | Mittel |
