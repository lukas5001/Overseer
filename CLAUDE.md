# Overseer – Monitoring System

## Projektübersicht

Overseer ist ein push-basiertes Monitoring-System für Multi-Tenant-Kundenumgebungen.
Zwei Monitoring-Modi:
1. **Collector** — Linux-VM beim Kunden, führt Checks remote aus (SNMP, Ping, SSH, HTTP)
2. **Agent** — Go-Binary direkt auf dem Zielrechner (Windows/Linux), führt Checks lokal aus

## Architektur

```
[Collector VMs] ──HTTPS POST──┐
                               ├──> [Receiver] --> [Redis Stream] --> [Worker Pool] --> [PostgreSQL + TimescaleDB]
[Agents (Go)]   ──HTTPS POST──┘                                                              |
       │                                                                   [REST API (FastAPI)] <--> [React Frontend]
       └── GET /api/v1/agent/config (Check-Definitionen holen)
       └── POST /api/v1/agent/heartbeat (Keepalive)
```

## Tech Stack

| Komponente | Technologie | Verzeichnis |
|-----------|-------------|-------------|
| Collector | Go 1.22+ | `/collector` |
| Agent | Go 1.22+ (Cross-Platform) | `/agent` |
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

# Agent bauen (Cross-Platform)
cd agent && make build-all   # → bin/overseer-agent + bin/overseer-agent.exe
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
2. **Collector + Agent** – Collector (Linux-VM) für remote Checks (SNMP, Ping, SSH, HTTP). Agent (Go-Binary) auf Zielmaschinen für lokale Checks (CPU, RAM, Disk, Services). Agent ersetzt WinRM-basierte Windows-Überwachung.
3. **Zentrale Konfiguration** – Collector und Agent holen ihre Config vom Server. Kein manuelles YAML-Editieren auf Kunden-VMs (nur `server_url` + `token`).
4. **Tenant-Isolation** – Jede DB-Query enthält automatisch einen tenant_id Filter. Auf ORM-Ebene erzwungen.
5. **Push-basiert** – Collectors und Agents senden Ergebnisse, Server empfängt passiv.
6. **Agent statt WinRM** – WinRM erfordert Inbound-Ports, Firewall-Konfiguration und Credentials. Der Agent braucht nur Outbound HTTPS 443, ist ein Single-Binary (~10 MB), und authentifiziert sich mit einem SHA256-gehashten Token.
7. **Server-Managed Scripts** – Monitoring-Scripts werden zentral in der DB (`monitoring_scripts`) verwaltet und über die API an Agents ausgeliefert. Alternativ können Agents auch lokale Scripts referenzieren.

## Sicherheitsarchitektur

### Shared-Code zwischen Services
Jeder Service hat seinen eigenen Docker-Build-Context (siehe Dockerfiles):
- `api`: kopiert nur `shared/` und `api/`
- `worker`: kopiert nur `shared/` und `worker/`
- `receiver`: kopiert nur `shared/` und `receiver/`

**Konsequenz**: Code der von mehreren Services benötigt wird, muss in `shared/` liegen — nicht in `api/app/core/`. Beispiel: `shared/encryption.py` (nicht `api/app/core/`). `api/app/core/encryption.py` existiert nur als Re-Export für API-interne Importe.

### Feldverschlüsselung (AES-256-GCM)
- `snmp_community` auf der `hosts`-Tabelle ist AES-256-GCM-verschlüsselt
- Implementierung: `shared/encryption.py` — `encrypt_field()` / `decrypt_field()`
- Der Worker entschlüsselt in `scheduler.py` nach `inject_host_credentials()`, bevor Checks ausgeführt werden
- Die API maskiert das Feld in `HostOut` als `"***"` — es wird nie im Klartext zurückgegeben
- Legacy-Werte (unverschlüsselt) werden von `decrypt_field()` transparent durchgereicht (Fallback)
- **ENV**: `FIELD_ENCRYPTION_KEY` muss ein Base64url-kodierter 32-Byte-Key sein

### Email-2FA
- Codes sind 8-stellig (statt früher 6)
- Codes werden als SHA256-Hash gespeichert — Plaintext nie in DB
- 5 Fehlversuche → 30-Minuten-Lockout (HTTP 429 mit `Retry-After`)
- Felder: `two_fa_email_code_hash`, `two_fa_attempts`, `two_fa_lockout_until` (seit Migration 013)

### API-Keys (Collectors)
- `key_prefix` wird für neue Keys nicht mehr geschrieben (leerer String)
- Lookup im Receiver erfolgt ausschließlich über `key_hash` (SHA256)
- Der volle Key wird dem User **einmalig** beim Erstellen zurückgegeben

### Agent-Tokens
- Format: `overseer_agent_` + 32 Zeichen (URL-safe Base64)
- Gespeichert als SHA256-Hash in `agent_tokens.token_hash`
- 1:1 Bindung an einen Host (1 Token pro Host)
- Auth über `X-Agent-Token` Header (separate Validierung, kein JWT)
- Receiver akzeptiert sowohl `X-API-Key` (Collector) als auch `X-Agent-Token` (Agent)
- Check-Typen mit Agent: `agent_cpu`, `agent_memory`, `agent_disk`, `agent_service`, `agent_process`, `agent_eventlog`, `agent_custom`, `agent_script`, `agent_services_auto`
- Check-Mode für Agent-Checks: `agent` (statt `passive` oder `active`)
- Agent-Tokens können nur für Host-Typen mit `agent_capable=true` generiert werden

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
- `NO_DATA` (3) – Keine Daten empfangen (neuer Service, Agent/Collector offline). Orange im Frontend.
- `UNKNOWN` (4) – Check wurde ausgeführt, aber Ergebnis unklar (z.B. Plugin-Exit-Code 3)

### Severity-Reihenfolge
CRITICAL > WARNING > NO_DATA > UNKNOWN > OK

### Wann wird NO_DATA gesetzt?
- **Neuer Service erstellt** → initial status = NO_DATA (statt UNKNOWN)
- **Agent offline** → dead_agent_watcher setzt Services auf NO_DATA
- **Collector offline** → dead_collector_watcher setzt Services auf NO_DATA
- Sobald ein Check-Ergebnis eintrifft, wechselt der Status auf das tatsächliche Ergebnis

## Soft/Hard States

- Check schlägt fehl → Soft State (Zähler hochzählen)
- Nach X aufeinanderfolgenden Fehlschlägen → Hard State
- Nur Hard States erscheinen in der Fehlerübersicht
- **Retry-Intervall** (seit Migration 026): Feld `retry_interval_seconds` auf `services`. Bei SOFT State (Check fehlgeschlagen, noch nicht HARD) wird mit kürzerem Intervall nachgeprüft statt das volle Intervall abzuwarten. Default 15s. Beispiel: 60s Intervall + 15s Retry + 3 Attempts → 90s Fehlererkennung statt 180s. Nur fehlschlagende Checks werden öfter geprüft — kein Mehraufwand bei Scale.

## Bekannte Fallstricke

### JWT User-ID existiert nicht in der DB
Die Produktions-DB wurde mehrfach re-seeded. Dadurch enthalten aktive JWT-Tokens User-IDs (`sub` claim), die nicht mehr in der `users`-Tabelle existieren.

**Regel:** NIEMALS Foreign-Key-Constraints auf `users(id)` verwenden für Spalten die aus `user["sub"]` (JWT) befüllt werden. Die FK-Constraints auf `saved_filters.created_by`, `downtimes.author_id`, `current_status.acknowledged_by` und `audit_log.user_id` wurden entfernt. Bei neuen Tabellen/Spalten die eine User-Referenz speichern: **kein FK**, nur UUID-Spalte.

Ebenso: API-Endpoints die `user["sub"]` nutzen um User in der DB zu suchen (z.B. `/me`) müssen graceful damit umgehen wenn der User nicht existiert.

### datetime-local Inputs im Frontend
`datetime-local` HTML-Inputs erwarten **lokale Zeit**. Niemals `toISOString().slice(0,16)` verwenden (gibt UTC!). Stattdessen immer `getFullYear()/getMonth()/getDate()/getHours()/getMinutes()` benutzen.

## Check-Erstellungs-Validierung

Beim Erstellen von Checks (`POST /api/v1/services/`) gelten folgende Backend-Validierungen:
- **Agent-Checks** (`check_type.startswith('agent_')` oder `check_mode='agent'`) → Host muss `agent_managed=true` haben
- **Passive Checks** (`check_mode='passive'`) → Host muss `collector_id` haben
- **Netzwerk-Checks** (`ping`, `port`, `snmp*`, `ssh_*`) → Host muss `ip_address` haben
- **check_type** ist nach Erstellung unveränderlich (PATCH lehnt Änderungen ab)
- **Intervall** muss zwischen 10 Sekunden und 7 Tagen liegen (POST und PATCH)
- **Retry-Intervall** muss ≥ 5s und ≤ Hauptintervall sein

Das Frontend filtert Check-Typen und Templates kontextabhängig nach Host-Capabilities (`agent_capable`, `snmp_enabled`, `ip_required`).
Templates werden OS-aware gefiltert: Linux-Hosts sehen keine Windows-Templates und umgekehrt. Ein Template wird angezeigt wenn mindestens ein Check kompatibel ist.

## Monitoring Scripts

- Tabelle: `monitoring_scripts` (Migration 022)
- API: `/api/v1/scripts/` (CRUD, admin-only Schreibzugriff)
- Frontend: `/scripts` Seite (ScriptsPage.tsx)
- Felder: `name`, `description`, `interpreter` (powershell/bash/python), `script_body`, `expected_output` (nagios/text/json)
- Tenant-isoliert mit `UNIQUE(tenant_id, name)`
- Agent holt Script-Inhalt über Config-Endpoint: `script_id` → `script_content` + `script_interpreter` + `expected_output`

## Konfigurierbare Host-Typen

Seit Migration 025 werden Host-Typen nicht mehr als Enum sondern als konfigurierbare Datensätze in der `host_types` Tabelle verwaltet.

- **Tabelle**: `host_types` mit Capabilities: `agent_capable`, `snmp_enabled`, `ip_required`, `os_family`
- **API**: `/api/v1/host-types/` (CRUD, super_admin)
- **Frontend**: `/host-types` Seite mit Icon-Picker, Capability-Toggles, Kategorien
- **Host-Formular**: Visueller Typ-Selector statt Dropdown, dynamische Felder je nach Typ-Capabilities
- **System-Typen** (is_system=true): Linux Server, Windows Server, Switch, Router, Firewall, Access Point, Drucker, Sonstiges — können nicht gelöscht werden
- **Admins** können eigene Typen erstellen (z.B. "IP Kamera", "NAS", "Cloud VM")
- `hosts.host_type_id` ist FK auf `host_types.id` (alte `host_type` Enum wurde entfernt)
- Icons kommen aus Lucide, gemappt über `getHostTypeIcon()` in `frontend/src/lib/constants.ts`

## Agent-Installation (Linux)

One-Command-Installer: `wget -qO- SERVER/agent/install.sh | bash -s -- TOKEN SERVER_URL`

- Script: `agent/deploy/install-remote.sh`, deployed nach `/opt/overseer/agent-binaries/install.sh`
- Unterstützt wget und curl (Auto-Detect), keine sudo-Abhängigkeit (muss als root laufen)
- Installiert Binary, Config, systemd-Unit, startet Agent
- Re-run safe: stoppt bestehenden Agent, überschreibt Binary + Config
- Binary: statisch gelinkt (`CGO_ENABLED=0`), ~6.5 MB
- Frontend zeigt distro-spezifische Tabs (Debian, RHEL, Generic) mit Prerequisite-Commands
- **Achtung Loopback**: Wenn Agent auf dem gleichen Server wie Overseer läuft, muss die Config-URL die interne Adresse oder den richtigen Domainnamen nutzen (nicht `overseer.2li.ch` wenn das Cert für `overseer.dailycrust.it` ausgestellt ist)

## Produktionsserver

- Server: `212.227.88.119` (IONOS VPS, hostet sowohl Overseer als auch DailyCrust)
- Domain: `overseer.dailycrust.it` (Let's Encrypt SSL)
- Services: `overseer-api`, `overseer-receiver`, `overseer-worker@{0,1,2}`, `overseer-agent` (systemd)
- DB: PostgreSQL 17 nativ (kein Docker), User `overseer`, Passwort in `/opt/overseer/.env`
- Frontend: Vite-Build nach `/opt/overseer/frontend/dist`, nginx reverse proxy
- Deploy: `git pull` → `npm run build` → `systemctl restart overseer-*`
- Migration: `DATABASE_URL_SYNC="postgresql://overseer:overseer_prod_2026@localhost/overseer" python3 scripts/migrate.py`
- Aktuelle Migration: 026 (retry_interval)
- Agent überwacht den eigenen Server (DailyCrust VPS) mit CPU, RAM, Disk, Services, Ping, Ports
