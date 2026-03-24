# Overseer – Monitoring System

## Projektübersicht

Overseer ist ein push-basiertes Monitoring-System für Multi-Tenant-Kundenumgebungen.
Bei jedem Kunden steht eine Linux-VM ("Collector"), die Checks gegen Server, Switches,
Router und andere Hardware ausführt und die Ergebnisse an den zentralen Server sendet.

## Architektur

```
[Collector VMs] --HTTPS POST--> [Receiver] --> [Redis Stream] --> [Worker Pool] --> [PostgreSQL + TimescaleDB]
                                                                                          |
                                                                        [REST API (FastAPI)] <--> [React Frontend]
```

## Tech Stack

| Komponente | Technologie | Verzeichnis |
|-----------|-------------|-------------|
| Collector | Go 1.22+ | `/collector` |
| Receiver | Python 3.12 + FastAPI | `/receiver` |
| Worker | Python 3.12 + asyncio | `/worker` |
| API | Python 3.12 + FastAPI | `/api` |
| Frontend | React 18 + TypeScript + Vite | `/frontend` |
| Shared Schemas | Python (Pydantic) | `/shared` |
| Datenbank | PostgreSQL 16 + TimescaleDB | `/migrations` |
| Queue | Redis 7 Streams | via Docker |
| Deployment | Docker Compose | `/deploy` |

## Entwicklungsumgebung

```bash
# Alles starten
docker compose up -d

# Nur Infrastruktur (DB + Redis)
docker compose up -d postgres redis

# Migrations ausführen
python scripts/migrate.py

# API starten (Entwicklung)
cd api && uvicorn app.main:app --reload --port 8000

# Receiver starten (Entwicklung)
cd receiver && uvicorn app.main:app --reload --port 8001

# Worker starten (Entwicklung)
cd worker && python -m app.main

# Frontend starten (Entwicklung)
cd frontend && npm run dev

# Collector bauen
cd collector && go build -o overseer-collector ./cmd/
```

## Konventionen

- **Python**: PEP 8, Type Hints überall, Pydantic für Validierung
- **Go**: Standard Go Formatting (gofmt), Error Handling explizit
- **API**: Alle Endpunkte unter `/api/v1/`, JWT-Auth, Tenant-Filter automatisch
- **Datenbank**: Migrations nummeriert (`001_initial.sql`, `002_...`), niemals Schema direkt ändern
- **Git**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`)
- **Docker**: Jede Komponente hat ein eigenes Dockerfile im jeweiligen Verzeichnis

## Wichtige Design-Entscheidungen

1. **Kein Alerting** – Es gibt keine automatische Benachrichtigung. Stattdessen eine Live-Fehlerübersicht die Mitarbeiter ständig beobachten.
2. **Collector statt Agent** – Kein Agent auf Zielmaschinen. Pro Kunde eine Linux-VM die alle Checks remote ausführt (SNMP, Ping, SSH, HTTP).
3. **Zentrale Konfiguration** – Collector holt seine Config vom Server. Kein manuelles YAML-Editieren auf Kunden-VMs.
4. **Tenant-Isolation** – Jede DB-Query enthält automatisch einen tenant_id Filter. Auf ORM-Ebene erzwungen.
5. **Push-basiert** – Collectors senden Ergebnisse, Server empfängt passiv.

## Sicherheitsarchitektur

### Shared-Code zwischen Services
Jeder Service hat seinen eigenen Docker-Build-Context (siehe Dockerfiles):
- `api`: kopiert nur `shared/` und `api/`
- `worker`: kopiert nur `shared/` und `worker/`
- `receiver`: kopiert nur `shared/` und `receiver/`

**Konsequenz**: Code der von mehreren Services benötigt wird, muss in `shared/` liegen — nicht in `api/app/core/`. Beispiel: `shared/encryption.py` (nicht `api/app/core/`). `api/app/core/encryption.py` existiert nur als Re-Export für API-interne Importe.

### Feldverschlüsselung (AES-256-GCM)
- `winrm_password` und `snmp_community` auf der `hosts`-Tabelle sind AES-256-GCM-verschlüsselt
- Implementierung: `shared/encryption.py` — `encrypt_field()` / `decrypt_field()`
- Der Worker entschlüsselt in `scheduler.py` nach `inject_host_credentials()`, bevor Checks ausgeführt werden
- Die API maskiert beide Felder in `HostOut` als `"***"` — sie werden nie im Klartext zurückgegeben
- Legacy-Werte (unverschlüsselt) werden von `decrypt_field()` transparent durchgereicht (Fallback)
- **ENV**: `FIELD_ENCRYPTION_KEY` muss ein Base64url-kodierter 32-Byte-Key sein

### Email-2FA
- Codes sind 8-stellig (statt früher 6)
- Codes werden als SHA256-Hash gespeichert — Plaintext nie in DB
- 5 Fehlversuche → 30-Minuten-Lockout (HTTP 429 mit `Retry-After`)
- Felder: `two_fa_email_code_hash`, `two_fa_attempts`, `two_fa_lockout_until` (seit Migration 013)

### API-Keys
- `key_prefix` wird für neue Keys nicht mehr geschrieben (leerer String)
- Lookup im Receiver erfolgt ausschließlich über `key_hash` (SHA256)
- Der volle Key wird dem User **einmalig** beim Erstellen zurückgegeben

### Rate Limiting (slowapi)
- Login-Endpoint `/api/v1/auth/login`: 10 req/min pro IP
- 2FA-Verify `/api/v1/auth/2fa/verify`: 10 req/min pro IP
- Globaler Limiter registriert in `api/app/main.py`

### Distributed Locking
- `downtime_expiry_watcher` und `dead_collector_watcher` in `api/app/main.py` laufen hinter Redis-Locks
- Lock-Keys: `overseer:lock:downtime_watcher`, `overseer:lock:dead_collector_watcher`
- Timeout: 55 s, blocking_timeout: 1 s → bei mehreren API-Replicas läuft nur eine Instanz pro Watcher

## Status-Modell

- `OK` (0) – Alles in Ordnung
- `WARNING` (1) – Schwellwert überschritten
- `CRITICAL` (2) – Kritischer Schwellwert überschritten
- `UNKNOWN` (3) – Check konnte nicht ausgeführt werden

## Soft/Hard States

- Check schlägt fehl → Soft State (Zähler hochzählen)
- Nach X aufeinanderfolgenden Fehlschlägen → Hard State
- Nur Hard States erscheinen in der Fehlerübersicht

## Bekannte Fallstricke

### JWT User-ID existiert nicht in der DB
Die Produktions-DB wurde mehrfach re-seeded. Dadurch enthalten aktive JWT-Tokens User-IDs (`sub` claim), die nicht mehr in der `users`-Tabelle existieren.

**Regel:** NIEMALS Foreign-Key-Constraints auf `users(id)` verwenden für Spalten die aus `user["sub"]` (JWT) befüllt werden. Die FK-Constraints auf `saved_filters.created_by`, `downtimes.author_id`, `current_status.acknowledged_by` und `audit_log.user_id` wurden entfernt. Bei neuen Tabellen/Spalten die eine User-Referenz speichern: **kein FK**, nur UUID-Spalte.

Ebenso: API-Endpoints die `user["sub"]` nutzen um User in der DB zu suchen (z.B. `/me`) müssen graceful damit umgehen wenn der User nicht existiert.

### datetime-local Inputs im Frontend
`datetime-local` HTML-Inputs erwarten **lokale Zeit**. Niemals `toISOString().slice(0,16)` verwenden (gibt UTC!). Stattdessen immer `getFullYear()/getMonth()/getDate()/getHours()/getMinutes()` benutzen.
