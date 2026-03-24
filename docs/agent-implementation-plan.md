# Overseer Agent — Implementierungsplan

## Zusammenfassung

Der Overseer Agent ersetzt die WinRM-basierte Windows-Überwachung durch einen leichtgewichtigen, push-basierten Agent (Go-Binary), der auf dem Zielrechner läuft. Er holt sich seine Konfiguration vom Overseer-Server, führt Checks lokal aus und schickt die Ergebnisse per HTTPS zurück.

**Kernprinzipien:**
- Kein Inbound-Port nötig — Agent verbindet sich nur nach außen (HTTPS 443)
- Minimale Konfiguration am Agent: nur `server_url` + `agent_token`
- Alles andere (Checks, Intervalle, Schwellwerte) wird zentral in Overseer konfiguriert
- Wiederverwendung der bestehenden Pipeline: Ergebnisse fließen durch den gleichen Receiver → Redis Stream → Worker Pfad wie Collector-Daten
- Single Binary (~8 MB), keine Runtime-Dependencies, Windows + Linux aus einer Codebasis

**Skalierungsziel:** 20.000+ Checks verteilt auf hunderte Agents.

---

## Architektur-Übersicht

```
┌──────────────────────────────┐
│  Agent (Go Binary)           │
│  Windows Service / systemd   │
│                              │
│  Config: server_url + token  │
│                              │
│  ┌────────────────────────┐  │
│  │ Built-in Checks:       │  │
│  │  cpu, memory, disk,    │  │
│  │  service, process,     │  │
│  │  eventlog, custom_cmd  │  │
│  └────────────────────────┘  │
│                              │
│  Loop:                       │
│  1. Config holen (alle 5m)   │
│  2. Checks ausführen         │
│  3. Ergebnisse senden        │
│  4. Heartbeat                │
└──────────┬───────────────────┘
           │ HTTPS (443) — nur ausgehend
           ▼
┌──────────────────────────────┐
│  Overseer Server             │
│                              │
│  GET  /api/v1/agent/config   │  ← Agent holt Check-Definitionen
│  POST /api/v1/results        │  ← Ergebnisse in bestehende Pipeline (Receiver)
│  POST /api/v1/agent/heartbeat│  ← Keepalive
│                              │
│  Redis Stream → Worker →     │
│  PostgreSQL + TimescaleDB    │
└──────────────────────────────┘
```

**Wiederverwendung bestehender Infrastruktur:**
- **Receiver** (`POST /api/v1/results`): Agent sendet Ergebnisse im gleichen Format wie Collector → gleicher Redis Stream → gleicher Worker
- **Worker**: Batch-Verarbeitung, State Machine (Soft/Hard), check_results + current_status Upsert — alles unverändert
- **API-Key-System**: Agent bekommt eigenen API-Key (SHA256-Hash + Prefix, gleiche Validierung wie Collector)
- **Rate Limiting**: Bestehendes Redis-basiertes Rate Limiting im Receiver greift auch für Agent-Requests

---

## Check-Typen

Neue Agent-spezifische Check-Typen (lokal ausgeführt, kein Netzwerkzugriff nötig):

| Check-Typ | Beschreibung | Config | Plattform |
|-----------|-------------|--------|-----------|
| `agent_cpu` | CPU-Auslastung (%) | — | Win + Linux |
| `agent_memory` | RAM-Auslastung (%) | — | Win + Linux |
| `agent_disk` | Festplatten-Belegung (%) | `{"path": "C:"}` oder `{"path": "/"}` | Win + Linux |
| `agent_service` | Windows-Dienst / systemd-Unit Status | `{"service": "MSSQLSERVER"}` | Win + Linux |
| `agent_process` | Prozess läuft? | `{"process": "nginx"}` | Win + Linux |
| `agent_eventlog` | Windows Event Log Prüfung | `{"log": "System", "level": "Error", "minutes": 30}` | Windows |
| `agent_custom` | Beliebiges Kommando (PowerShell/Bash) | `{"command": "Get-Process \| Measure", "ok_pattern": ".", "crit_pattern": ""}` | Win + Linux |

**Standard-Intervalle:**
| Check-Typ | Default-Intervall | Empfehlung bei Scale |
|-----------|-------------------|---------------------|
| `agent_cpu` | 60s | 120s |
| `agent_memory` | 60s | 120s |
| `agent_disk` | 300s | 300s |
| `agent_service` | 120s | 120s |
| `agent_process` | 120s | 120s |
| `agent_eventlog` | 300s | 300s |
| `agent_custom` | 120s | individuell |

---

## Datenmodell-Änderungen

### Neue Tabelle: `agent_tokens`

```sql
CREATE TABLE agent_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,      -- SHA256 des Tokens
    token_prefix VARCHAR(16) NOT NULL,    -- erste 16 Zeichen für Identifikation
    name VARCHAR(255) DEFAULT 'default',
    active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    agent_version VARCHAR(50),            -- vom Agent gemeldet
    agent_os VARCHAR(50),                 -- vom Agent gemeldet (windows/linux)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(token_hash)
);
CREATE INDEX idx_agent_tokens_prefix ON agent_tokens(token_prefix);
CREATE INDEX idx_agent_tokens_host ON agent_tokens(host_id);
```

**Warum eigene Tabelle statt API-Keys?**
- Agent-Tokens sind 1:1 an einen Host gebunden (Collector-API-Keys sind 1:N)
- Agent-spezifische Metadaten (Version, OS, last_seen)
- Saubere Trennung: Agent-Token ≠ Collector-API-Key ≠ User-JWT

### Neues Feld auf `hosts`

```sql
ALTER TABLE hosts ADD COLUMN agent_managed BOOLEAN NOT NULL DEFAULT false;
```

Wenn `agent_managed = true`:
- Host wird von einem Agent überwacht
- Config-Endpoint liefert Agent-Check-Typen
- Frontend zeigt Agent-Status-Indicator

### Services: Neuer `check_mode`

Bestehende Werte: `passive` (Collector), `active` (Server).
Neuer Wert: `agent`.

```sql
-- Kein DDL nötig — check_mode ist VARCHAR(10), 'agent' passt rein
```

---

## API-Endpunkte

### 1. Agent-Token generieren (Admin)

```
POST /api/v1/hosts/{host_id}/agent-token
Auth: JWT (tenant_admin+)
Response: { "token": "overseer_agent_xxxxxxxx...", "host_id": "...", "expires_hint": "never" }
```

Token wird nur einmal im Klartext zurückgegeben.
Setzt automatisch `hosts.agent_managed = true`.

### 2. Agent-Token widerrufen (Admin)

```
DELETE /api/v1/hosts/{host_id}/agent-token
Auth: JWT (tenant_admin+)
```

Setzt `agent_tokens.active = false` und `hosts.agent_managed = false`.

### 3. Agent Config abrufen (Agent)

```
GET /api/v1/agent/config
Auth: X-Agent-Token: <token>
Response:
{
  "host_id": "uuid",
  "hostname": "srv-dc-01",
  "tenant_id": "uuid",
  "config_interval_seconds": 300,
  "checks": [
    {
      "service_id": "uuid",
      "name": "CPU",
      "check_type": "agent_cpu",
      "config": {},
      "interval_seconds": 60,
      "threshold_warn": 80.0,
      "threshold_crit": 95.0,
      "max_check_attempts": 3
    },
    {
      "service_id": "uuid",
      "name": "Disk C:",
      "check_type": "agent_disk",
      "config": {"path": "C:"},
      "interval_seconds": 300,
      "threshold_warn": 80.0,
      "threshold_crit": 90.0,
      "max_check_attempts": 3
    }
  ]
}
```

Nur Services mit `check_mode = 'agent'` und `active = true` werden geliefert.

### 4. Ergebnisse senden (Agent → bestehender Receiver)

```
POST /api/v1/results
Auth: X-Agent-Token: <token>  (Receiver akzeptiert beide: X-API-Key und X-Agent-Token)
Body: CollectorPayload-kompatibel
{
  "collector_id": "agent:<host_id>",
  "tenant_id": "uuid",
  "timestamp": "2026-03-24T12:00:00Z",
  "checks": [
    {
      "host": "srv-dc-01",
      "name": "CPU",
      "status": "OK",
      "value": 23.5,
      "unit": "%",
      "message": "CPU OK - 23.5%",
      "check_type": "agent_cpu",
      "check_duration_ms": 12
    }
  ]
}
```

**Warum Receiver wiederverwenden?**
- Gleiche Redis-Stream-Pipeline, gleicher Worker, gleiche Batch-Verarbeitung
- Rate Limiting bereits implementiert
- Kein doppelter Code für Ergebnis-Verarbeitung
- Worker-Cache kennt bereits Host/Service-Zuordnung

### 5. Heartbeat (Agent)

```
POST /api/v1/agent/heartbeat
Auth: X-Agent-Token: <token>
Body: { "agent_version": "1.0.0", "os": "windows", "hostname": "SRV-DC-01" }
```

Aktualisiert `agent_tokens.last_seen_at`, `agent_version`, `agent_os`.

---

## Go-Agent Architektur

```
agent/
├── cmd/
│   └── overseer-agent/
│       └── main.go              # Einstiegspunkt, CLI-Flags, Service-Mode
├── internal/
│   ├── config/
│   │   ├── config.go            # Konfiguration (YAML + CLI-Flags)
│   │   └── remote.go            # Config vom Server holen
│   ├── checks/
│   │   ├── registry.go          # Check-Typ → Funktion Mapping
│   │   ├── cpu.go               # CPU-Check (cross-platform)
│   │   ├── cpu_windows.go       # Windows-spezifisch (WMI/PDH)
│   │   ├── cpu_linux.go         # Linux-spezifisch (/proc/stat)
│   │   ├── memory.go            # RAM-Check
│   │   ├── memory_windows.go
│   │   ├── memory_linux.go
│   │   ├── disk.go              # Disk-Check
│   │   ├── disk_windows.go
│   │   ├── disk_linux.go
│   │   ├── service.go           # Service-Status
│   │   ├── service_windows.go   # Windows SCM API
│   │   ├── service_linux.go     # systemd D-Bus
│   │   ├── process.go           # Prozess-Check
│   │   ├── eventlog_windows.go  # Windows Event Log
│   │   └── custom.go            # Beliebiges Kommando
│   ├── scheduler/
│   │   └── scheduler.go         # Check-Scheduling mit individuellen Intervallen
│   ├── sender/
│   │   └── sender.go            # Ergebnisse batchen und senden, Retry-Logik
│   ├── heartbeat/
│   │   └── heartbeat.go         # Keepalive-Sender
│   └── service/
│       ├── service_windows.go   # Windows-Service-Integration
│       └── service_linux.go     # (nur Hinweis auf systemd)
├── go.mod
├── go.sum
├── Makefile                     # Cross-Compile: windows/amd64, linux/amd64
└── README.md
```

### Agent-Config (lokal, minimal)

```yaml
# /etc/overseer-agent/config.yaml (Linux)
# C:\ProgramData\Overseer\Agent\config.yaml (Windows)
server: https://overseer.dailycrust.it
token: overseer_agent_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Alles andere kommt vom Server.

### Agent Main Loop

```
┌─────────────────────────────────────────────────┐
│  Start                                          │
│  ├── Config laden (lokal: server + token)       │
│  ├── Config vom Server holen (GET /agent/config)│
│  ├── Scheduler initialisieren                   │
│  │                                              │
│  │  ┌─ Config-Refresh Goroutine (alle 5 min) ─┐│
│  │  │  GET /api/v1/agent/config                ││
│  │  │  Scheduler aktualisieren                 ││
│  │  └─────────────────────────────────────────┘│
│  │                                              │
│  │  ┌─ Check-Scheduler Goroutine ─────────────┐│
│  │  │  Für jeden Check:                       ││
│  │  │    if time_since_last >= interval:       ││
│  │  │      result = execute_check()           ││
│  │  │      add_to_batch(result)               ││
│  │  │  Tick: jede Sekunde                     ││
│  │  └─────────────────────────────────────────┘│
│  │                                              │
│  │  ┌─ Result-Sender Goroutine ───────────────┐│
│  │  │  Batch sammeln (max 100 oder 10s flush) ││
│  │  │  POST /api/v1/results                   ││
│  │  │  Bei Fehler: Retry (3x, exp. backoff)   ││
│  │  │  Bei anhaltendem Fehler: Buffer lokal    ││
│  │  └─────────────────────────────────────────┘│
│  │                                              │
│  │  ┌─ Heartbeat Goroutine (alle 60s) ────────┐│
│  │  │  POST /api/v1/agent/heartbeat            ││
│  │  └─────────────────────────────────────────┘│
│  │                                              │
│  ├── Graceful Shutdown (SIGTERM / Service Stop) │
│  └── Pending Results flushen                    │
└─────────────────────────────────────────────────┘
```

### Skalierungs-Design (20.000+ Checks)

**Agent-Seite:**
- Checks laufen in Worker-Pool (Goroutines, Standard: `runtime.NumCPU()`)
- Jeder Check hat sein eigenes Intervall-Tracking (Heap-basierte Priority Queue)
- Ergebnisse werden gesammelt und gebatcht (max 100 pro Payload ODER alle 10 Sekunden flush)
- Kein Check blockiert andere (Timeouts: 30s default, konfigurierbar)

**Server-Seite (bestehende Infrastruktur, bereits skalierbar):**
- **Receiver**: Rate Limiting 120 req/60s pro Agent-Token-Prefix → reicht für 1 Request/Minute/Agent
- **Redis Stream**: Consumer Group mit konfigurierbarer Worker-Concurrency (default 4)
- **Worker**: Batch-Verarbeitung (100 Messages pro Read), In-Memory-Cache eliminiert DB-Lookups
- **DB**: TimescaleDB Hypertable mit automatischer 90-Tage-Retention
- **Berechnung**: 2000 Agents × 10 Checks × 60s Intervall = ~333 Results/s → 1 Batch-Request pro Agent/Minute = ~33 HTTP-Requests/s → trivial

**Engpass-Vermeidung:**
- Agent-Config-Endpoint gecacht (Config ändert sich selten, 5-Minuten-Poll reicht)
- Heartbeat ist lightweight (1 DB-Update pro Agent pro Minute)
- Kein Polling vom Server zum Agent — immer Agent-initiated

---

## Frontend-Änderungen

### Host-Detail-Seite
- **Agent-Status-Badge**: Online/Offline (basierend auf `last_seen_at`, Threshold: 3 Minuten)
- **Agent-Info-Card**: Version, OS, zuletzt gesehen
- **Token-Management**: Token generieren / widerrufen Button
- **Check-Typ-Dropdown**: Neue `agent_*` Typen verfügbar wenn `agent_managed = true`

### Hosts-Übersicht
- **Agent-Managed-Indicator**: Kleines Icon neben Hostname wenn Agent-Managed
- **Filter**: "Agent-Hosts" als Filteroption

### Service Templates
- **Neues Template**: "Windows Server (Agent)" mit agent_cpu, agent_memory, agent_disk
- **Neues Template**: "Linux Server (Agent)" mit gleichen Checks

---

## Prompts (Reihenfolge der Umsetzung)

Die folgenden 6 Prompts sind so strukturiert, dass jeder Prompt ein funktionierendes Inkrement produziert.

---

### PROMPT 1 — Server-Fundament: DB, API-Endpunkte, Token-System

> Implementiere das Server-seitige Fundament für den Overseer Agent.
>
> **Kontext:** WinRM wurde entfernt. Wir bauen einen Go-basierten Agent der auf dem Zielrechner läuft, Config vom Server holt und Ergebnisse per HTTPS pusht. Dieser Prompt baut die Server-Seite.
>
> **1. Migration `021_agent_support.sql`:**
> - Neue Tabelle `agent_tokens` mit: id (UUID PK), host_id (FK hosts CASCADE), tenant_id (FK tenants CASCADE), token_hash (VARCHAR 64, UNIQUE), token_prefix (VARCHAR 16), name (VARCHAR 255, default 'default'), active (BOOLEAN default true), last_seen_at (TIMESTAMPTZ), agent_version (VARCHAR 50), agent_os (VARCHAR 50), created_at (TIMESTAMPTZ default now())
> - Indexes: token_prefix, host_id
> - Neues Feld auf hosts: `agent_managed BOOLEAN NOT NULL DEFAULT false`
> - check_mode Wert 'agent' braucht kein DDL (VARCHAR)
>
> **2. Neuer API-Router `api/app/routers/agent.py`:**
>
> Endpunkte für Admin (JWT-Auth):
> - `POST /api/v1/hosts/{host_id}/agent-token` — Token generieren. Format: `overseer_agent_` + 32 Zeichen URL-safe random. SHA256-Hash + Prefix (erste 16 Zeichen) in `agent_tokens` speichern. `hosts.agent_managed = true` setzen. Token einmalig im Klartext zurückgeben. Audit-Log schreiben.
> - `DELETE /api/v1/hosts/{host_id}/agent-token` — Token deaktivieren. `agent_tokens.active = false`, `hosts.agent_managed = false`. Audit-Log.
> - `GET /api/v1/hosts/{host_id}/agent-token` — Token-Metadaten (NICHT den Token selbst): active, last_seen_at, agent_version, agent_os, created_at.
>
> Endpunkte für Agent (Token-Auth via `X-Agent-Token` Header):
> - `GET /api/v1/agent/config` — Token validieren (SHA256-Hash-Lookup auf agent_tokens WHERE active=true). Aus der token_hash → host_id Zuordnung: alle Services für diesen Host laden WHERE check_mode='agent' AND active=true. Response: `{ host_id, hostname, tenant_id, config_interval_seconds: 300, checks: [{ service_id, name, check_type, config, interval_seconds, threshold_warn, threshold_crit, max_check_attempts }] }`
> - `POST /api/v1/agent/heartbeat` — Token validieren. Request-Body: `{ agent_version, os, hostname }`. Update: `agent_tokens.last_seen_at = now()`, agent_version, agent_os.
>
> Token-Validierung als Dependency extrahieren (`get_agent_auth`): Header `X-Agent-Token` lesen → SHA256 hashen → in agent_tokens nachschlagen → host_id + tenant_id zurückgeben.
>
> **3. Receiver erweitern (`receiver/app/main.py`):**
> - `POST /api/v1/results` akzeptiert jetzt AUCH `X-Agent-Token` Header (zusätzlich zu `X-API-Key`)
> - Wenn `X-Agent-Token` vorhanden: Token validieren wie oben (SHA256-Lookup in agent_tokens), tenant_id daraus ableiten
> - Rate Limiting greift wie bisher (mit token_prefix als Key)
> - `last_seen_at` auf agent_tokens aktualisieren (statt collectors.last_seen_at)
>
> **4. Frontend: HostDetailPage.tsx**
> - Neuer Abschnitt "Agent" auf der Host-Detail-Seite (über den Checks)
> - Wenn Host NICHT agent_managed: Button "Agent einrichten" → POST Token → Token einmalig anzeigen in einem Copy-to-Clipboard-Dialog
> - Wenn Host agent_managed: Agent-Status-Card mit: Status (Online/Offline basierend auf last_seen_at < 3min), Version, OS, Zuletzt gesehen, Button "Token widerrufen" (mit Bestätigung)
> - Check-Typ-Dropdown im "Check hinzufügen" Modal: agent_cpu, agent_memory, agent_disk, agent_service, agent_process, agent_eventlog, agent_custom hinzufügen
> - ConfigFields-Komponente für neue Check-Typen:
>   - agent_cpu: keine Felder
>   - agent_memory: keine Felder
>   - agent_disk: Feld "Pfad" (path), Placeholder "C:" oder "/"
>   - agent_service: Feld "Servicename" (service), Placeholder "MSSQLSERVER"
>   - agent_process: Feld "Prozessname" (process), Placeholder "nginx"
>   - agent_eventlog: Felder "Log" (log, default "System"), "Level" (level, default "Error"), "Minuten" (minutes, default "30")
>   - agent_custom: Felder "Kommando" (command), "OK Pattern" (ok_pattern), "Critical Pattern" (crit_pattern)
>
> **5. TypeScript-Types (`frontend/src/types/index.ts`):**
> - `Host` Interface: `agent_managed: boolean` hinzufügen
> - Neues Interface `AgentTokenInfo`: active, last_seen_at, agent_version, agent_os, created_at
>
> **6. Schemas (`shared/schemas/__init__.py`):**
> - `HostOut`: `agent_managed: bool = False` hinzufügen
>
> **7. Host-Model (`api/app/models/models.py`):**
> - `agent_managed = Column(Boolean, nullable=False, default=False)` auf Host
>
> **8. Service Templates aktualisieren (`scripts/seed_builtin_templates.py`):**
> - "Generic Windows Server" Template: agent_cpu, agent_memory, agent_disk(C:), agent_service(W32Time) mit check_mode='agent'
> - Neues "Generic Linux Server (Agent)" Template: agent_cpu, agent_memory, agent_disk(/), agent_service(sshd) mit check_mode='agent'
>
> Teste alles mit dem bestehenden Frontend-Build. Die Agent-Check-Typen müssen im Dropdown sichtbar und konfigurierbar sein.

---

### PROMPT 2 — Go-Agent: Grundgerüst, Config, HTTP-Client

> Implementiere das Go-Agent-Grundgerüst unter `agent/` im Overseer-Repository.
>
> **Kontext:** Die Server-Seite (Prompt 1) ist fertig. Der Agent holt Config vom Server und sendet Ergebnisse zurück. Dieser Prompt baut die Basis-Infrastruktur des Go-Agents.
>
> **1. Projekt-Struktur:**
> ```
> agent/
> ├── cmd/overseer-agent/main.go
> ├── internal/
> │   ├── config/config.go       # Lokale Config (YAML)
> │   ├── config/remote.go       # Remote Config vom Server
> │   ├── client/client.go       # HTTP-Client mit Auth + Retry
> │   ├── types/types.go         # Shared Types (CheckResult, RemoteConfig, etc.)
> │   └── version/version.go     # Build-Time Version-Injection
> ├── go.mod
> └── Makefile
> ```
>
> **2. `internal/config/config.go` — Lokale Konfiguration:**
> ```go
> type Config struct {
>     Server    string `yaml:"server"`     // https://overseer.example.com
>     Token     string `yaml:"token"`      // overseer_agent_xxxxx
>     LogLevel  string `yaml:"log_level"`  // debug, info, warn, error (default: info)
>     LogFile   string `yaml:"log_file"`   // optional, default: stdout
> }
> ```
> - Laden aus YAML-Datei: `/etc/overseer-agent/config.yaml` (Linux), `C:\ProgramData\Overseer\Agent\config.yaml` (Windows)
> - Config-Pfad überschreibbar via CLI-Flag `--config`
> - Server und Token sind Pflichtfelder, Validierung beim Start
>
> **3. `internal/client/client.go` — HTTP-Client:**
> - Basis-HTTP-Client mit:
>   - `X-Agent-Token` Header automatisch gesetzt
>   - User-Agent: `Overseer-Agent/<version> (<os>/<arch>)`
>   - Timeout: 30s
>   - TLS: Zertifikat-Validierung an (aber überschreibbar via Config `insecure_skip_verify: true` für selbstsignierte Zertifikate)
>   - Keep-Alive aktiviert (Connection reuse)
> - Methoden:
>   - `FetchConfig() (*RemoteConfig, error)` — GET /api/v1/agent/config
>   - `SendResults(payload *ResultPayload) error` — POST /api/v1/results
>   - `SendHeartbeat(info *HeartbeatInfo) error` — POST /api/v1/agent/heartbeat
> - Retry-Logik: 3 Versuche, exponentielles Backoff (2s, 4s, 8s), nur bei Netzwerk-Fehlern und 5xx
>
> **4. `internal/types/types.go` — Typen:**
> ```go
> // Vom Server (Config-Antwort)
> type RemoteConfig struct {
>     HostID                string        `json:"host_id"`
>     Hostname              string        `json:"hostname"`
>     TenantID              string        `json:"tenant_id"`
>     ConfigIntervalSeconds int           `json:"config_interval_seconds"`
>     Checks                []CheckDef    `json:"checks"`
> }
> type CheckDef struct {
>     ServiceID       string         `json:"service_id"`
>     Name            string         `json:"name"`
>     CheckType       string         `json:"check_type"`
>     Config          map[string]any `json:"config"`
>     IntervalSeconds int            `json:"interval_seconds"`
>     ThresholdWarn   *float64       `json:"threshold_warn"`
>     ThresholdCrit   *float64       `json:"threshold_crit"`
>     MaxAttempts     int            `json:"max_check_attempts"`
> }
>
> // Zum Server (Ergebnisse)
> type ResultPayload struct {
>     CollectorID string        `json:"collector_id"` // "agent:<host_id>"
>     TenantID    string        `json:"tenant_id"`
>     Timestamp   string        `json:"timestamp"`    // RFC3339
>     Checks      []CheckResult `json:"checks"`
> }
> type CheckResult struct {
>     Host           string  `json:"host"`
>     Name           string  `json:"name"`
>     Status         string  `json:"status"` // OK, WARNING, CRITICAL, UNKNOWN
>     Value          *float64 `json:"value,omitempty"`
>     Unit           string  `json:"unit,omitempty"`
>     Message        string  `json:"message,omitempty"`
>     CheckType      string  `json:"check_type"`
>     CheckDurationMs int    `json:"check_duration_ms,omitempty"`
> }
>
> // Heartbeat
> type HeartbeatInfo struct {
>     AgentVersion string `json:"agent_version"`
>     OS           string `json:"os"`
>     Hostname     string `json:"hostname"`
> }
> ```
>
> **5. `cmd/overseer-agent/main.go` — Einstiegspunkt:**
> - CLI-Flags: `--config`, `--version`, `--install` (Windows Service registrieren), `--uninstall`, `--run` (Vordergrund)
> - Startup-Ablauf:
>   1. Lokale Config laden und validieren
>   2. Logger initialisieren
>   3. Remote Config holen (mit Retry, max 5 Versuche, exp. Backoff)
>   4. Log: "Connected to <server>, host=<hostname>, <n> checks configured"
>   5. Main-Loop starten (Placeholder — wird in Prompt 3 implementiert)
>   6. Graceful Shutdown auf SIGINT/SIGTERM
>
> **6. `internal/version/version.go`:**
> - `var Version string` — wird beim Build via `-ldflags` injiziert
> - `var BuildTime string`
> - `var GitCommit string`
>
> **7. `Makefile`:**
> - `build-windows`: `GOOS=windows GOARCH=amd64 go build -ldflags "-X .../version.Version=$(VERSION)" -o bin/overseer-agent.exe ./cmd/overseer-agent`
> - `build-linux`: `GOOS=linux GOARCH=amd64 go build ... -o bin/overseer-agent ./cmd/overseer-agent`
> - `build-all`: Beide
> - `VERSION` aus git tag oder Fallback "dev"
>
> **8. `go.mod`:**
> - Module: `github.com/lukas5001/overseer-agent`
> - Dependencies: `gopkg.in/yaml.v3` (YAML-Config), `golang.org/x/sys` (Windows-Service, kommt in Prompt 5)
> - Keine weiteren externen Dependencies — so leichtgewichtig wie möglich
>
> Stelle sicher, dass `go build ./cmd/overseer-agent` für beide Plattformen kompiliert. Der Agent soll starten, Config holen und "Ready, X checks configured" loggen können.

---

### PROMPT 3 — Check-Engine: Built-in Checks (Cross-Platform)

> Implementiere die Check-Engine und alle Built-in Checks für den Overseer Agent.
>
> **Kontext:** Das Go-Agent-Grundgerüst (Prompt 2) existiert. Jetzt werden die lokalen System-Checks implementiert — cross-platform für Windows und Linux.
>
> **1. `internal/checks/registry.go` — Check-Registry:**
> ```go
> type CheckFunc func(config map[string]any) CheckResult
>
> var registry = map[string]CheckFunc{
>     "agent_cpu":      checkCPU,
>     "agent_memory":   checkMemory,
>     "agent_disk":     checkDisk,
>     "agent_service":  checkService,
>     "agent_process":  checkProcess,
>     "agent_eventlog": checkEventlog,
>     "agent_custom":   checkCustom,
> }
>
> func Execute(checkType string, config map[string]any) CheckResult
> ```
> - `Execute()`: Lookup im Registry, Timeout-Wrapper (30s default), Panic-Recovery
> - Unbekannte Check-Typen → `UNKNOWN` mit "unsupported check type" Message
>
> **2. CPU-Check (`cpu.go` + `cpu_windows.go` + `cpu_linux.go`):**
> - **Linux** (`cpu_linux.go`): Zwei Snapshots von `/proc/stat` im Abstand von 1 Sekunde. Berechnung: `(total_used_diff / total_diff) * 100`
> - **Windows** (`cpu_windows.go`): WMI-Query `Win32_Processor` → `LoadPercentage`. Alternative: PDH Counter `\Processor(_Total)\% Processor Time`
> - Return: Status (OK/WARN/CRIT basierend auf Schwellwerten), Wert (%), Einheit "%"
> - Schwellwerte: aus Check-Config `threshold_warn` und `threshold_crit` (der Agent bekommt diese vom Server)
>
> **3. Memory-Check (`memory.go` + plattformspezifisch):**
> - **Linux**: `/proc/meminfo` parsen → MemTotal, MemAvailable. Usage = `(Total - Available) / Total * 100`
> - **Windows**: `GlobalMemoryStatusEx` API (syscall) oder WMI `Win32_OperatingSystem` → TotalVisibleMemorySize, FreePhysicalMemory
> - Return: Usage %, Status basierend auf Schwellwerten
>
> **4. Disk-Check (`disk.go` + plattformspezifisch):**
> - Config: `path` (z.B. "C:" oder "/")
> - **Linux**: `syscall.Statfs()` → Total, Free → Usage %
> - **Windows**: `GetDiskFreeSpaceEx` (syscall) → Total, Free → Usage %
> - Return: Usage %, Status, Message mit freiem Speicher in GB
>
> **5. Service-Check (`service.go` + plattformspezifisch):**
> - Config: `service` (Servicename)
> - **Linux**: `systemctl is-active <service>` ausführen → "active" = OK, sonst CRITICAL
> - **Windows**: Windows Service Control Manager API via `golang.org/x/sys/windows/svc/mgr` → SERVICE_RUNNING = OK, SERVICE_STOPPED = CRITICAL, andere = WARNING
> - Return: Status + Message ("Service X läuft" / "Service X gestoppt")
>
> **6. Process-Check (`process.go`):**
> - Config: `process` (Prozessname)
> - **Linux**: `/proc/[pid]/comm` durchsuchen oder `pgrep -c <process>`
> - **Windows**: `CreateToolhelp32Snapshot` + `Process32First/Next` (syscall) ODER `tasklist /FI "IMAGENAME eq <process>"` ausführen
> - Return: OK wenn gefunden (Wert = Anzahl Instanzen), CRITICAL wenn nicht gefunden
>
> **7. Event Log Check (`eventlog_windows.go`):**
> - Config: `log` (default "System"), `level` (default "Error"), `minutes` (default 30)
> - Windows: `wevtutil qe <log> /q:"*[System[TimeCreated[timediff(@SystemTime) <= <minutes*60000>] and (Level=1 or Level=2)]]" /c:1 /f:text`
> - Oder über die Event Log API (golang.org/x/sys/windows/svc/eventlog)
> - Return: CRITICAL wenn Events gefunden (Wert = Anzahl), OK wenn keine
> - **Linux**: Stub-Implementierung → UNKNOWN "Event Log check nur auf Windows verfügbar"
>
> **8. Custom Command Check (`custom.go`):**
> - Config: `command` (String), `ok_pattern` (Regex), `crit_pattern` (Regex)
> - Ausführung: `exec.Command("cmd", "/C", command)` (Windows) oder `exec.Command("sh", "-c", command)` (Linux)
> - Timeout: 30 Sekunden
> - Status-Bestimmung:
>   1. Exit Code ≠ 0 → CRITICAL
>   2. `crit_pattern` matcht stdout → CRITICAL
>   3. `ok_pattern` matcht stdout → OK
>   4. stdout nicht leer → OK
>   5. Sonst → WARNING
> - Wert: Erste Zahl aus stdout extrahieren (Regex `[-+]?\d+\.?\d*`)
>
> **9. Schwellwert-Auswertung:**
> - Zentrale Funktion `applyThresholds(value float64, warn, crit *float64) string`:
>   - value >= crit → "CRITICAL"
>   - value >= warn → "WARNING"
>   - sonst → "OK"
> - Wird von cpu, memory, disk Checks verwendet
> - Agent bekommt Schwellwerte vom Server in der Config
>
> **10. Tests:**
> - Unit Tests für jeden Check-Typ (soweit möglich ohne echtes System — z.B. Custom-Check mit echo-Kommando)
> - Integrationstest: `go test ./internal/checks/ -v` soll auf dem Build-System laufen
>
> Stelle sicher, dass `go build` für Windows und Linux kompiliert und die Checks auf dem aktuellen System ausführbar sind.

---

### PROMPT 4 — Scheduler, Batching, Result-Pipeline

> Implementiere den Check-Scheduler und die Result-Pipeline für den Overseer Agent.
>
> **Kontext:** Die Check-Engine (Prompt 3) existiert und kann einzelne Checks ausführen. Jetzt braucht der Agent die Orchestrierung: Wann welcher Check läuft, Ergebnisse sammeln, batchen, senden.
>
> **1. `internal/scheduler/scheduler.go` — Check-Scheduler:**
>
> **Anforderungen:**
> - Jeder Check hat sein eigenes Intervall (z.B. CPU alle 60s, Disk alle 300s)
> - Checks laufen parallel in einem Worker-Pool (Goroutines)
> - Pool-Größe: `runtime.NumCPU()` (mindestens 2, maximal 16)
> - Kein Check soll einen anderen blockieren (per-Check Timeout: 30s)
> - Config-Updates (vom Server) sollen live eingespeist werden (neue Checks starten, entfernte Checks stoppen, Intervall-Änderungen übernehmen)
>
> **Design:**
> ```go
> type Scheduler struct {
>     checks     map[string]*scheduledCheck  // service_id → check state
>     results    chan types.CheckResult       // Ergebnis-Channel
>     mu         sync.RWMutex
>     workerPool chan struct{}                // Semaphore für Parallelität
>     hostname   string
> }
>
> type scheduledCheck struct {
>     def      types.CheckDef
>     lastRun  time.Time
>     running  atomic.Bool  // Verhindert Doppel-Ausführung
> }
> ```
>
> - `UpdateConfig(checks []types.CheckDef)`: Neue Config einpflegen. Neue Checks hinzufügen, entfernte entfernen, bestehende aktualisieren.
> - `Run(ctx context.Context)`: Tick-Loop (jede Sekunde). Für jeden Check: Ist das Intervall abgelaufen UND läuft er nicht bereits? → In Worker-Pool ausführen.
> - Ergebnisse werden auf den `results` Channel geschrieben.
>
> **2. `internal/sender/sender.go` — Result-Sender mit Batching:**
>
> **Anforderungen:**
> - Ergebnisse aus dem `results` Channel lesen
> - Batchen: max 100 Ergebnisse pro Payload ODER Flush alle 10 Sekunden (was zuerst eintritt)
> - HTTP POST an Receiver `/api/v1/results`
> - Retry bei Fehler (3x, exp. Backoff: 2s, 4s, 8s)
> - Bei anhaltendem Server-Fehler: Ergebnisse in lokalen Ring-Buffer speichern (max 10.000 Ergebnisse). Beim nächsten erfolgreichen Send: Buffer zuerst senden.
> - Graceful Shutdown: Pending Batch flushen bevor Agent stoppt
>
> **Design:**
> ```go
> type Sender struct {
>     client      *client.Client
>     resultsChan <-chan types.CheckResult
>     hostID      string
>     hostname    string
>     tenantID    string
>     buffer      *ringBuffer  // Lokaler Buffer bei Server-Ausfall
> }
>
> func (s *Sender) Run(ctx context.Context)
> func (s *Sender) flush(batch []types.CheckResult) error
> ```
>
> **Ring-Buffer:**
> - Feste Größe: 10.000 Einträge
> - Älteste Einträge werden überschrieben wenn voll
> - Wird beim Start aus einer lokalen Datei geladen (optional, für Persistenz über Agent-Neustarts)
>
> **3. `internal/heartbeat/heartbeat.go` — Heartbeat-Sender:**
> - Alle 60 Sekunden: POST /api/v1/agent/heartbeat
> - Sendet: agent_version, os (runtime.GOOS), hostname (os.Hostname())
> - Bei Fehler: nur loggen, nicht crashen
>
> **4. Main Loop Integration (`cmd/overseer-agent/main.go`):**
> - Startup:
>   1. Config laden
>   2. Remote Config holen
>   3. Scheduler erstellen + starten
>   4. Sender erstellen + starten
>   5. Heartbeat starten
>   6. Config-Refresh Goroutine starten (alle 5 Minuten)
> - Config-Refresh:
>   1. Remote Config holen
>   2. `scheduler.UpdateConfig(newConfig.Checks)` aufrufen
>   3. Log: "Config refreshed: X checks" (nur wenn sich was geändert hat)
> - Shutdown (SIGINT/SIGTERM):
>   1. Scheduler stoppen (laufende Checks abwarten, max 30s)
>   2. Sender flushen (pending Batch senden)
>   3. Log: "Agent stopped gracefully"
>
> **5. Logging:**
> - Strukturiertes Logging: `log/slog` (Go stdlib, ab Go 1.21)
> - Log-Levels: debug, info, warn, error
> - Format: `time=2026-03-24T12:00:00Z level=INFO msg="Check completed" check=CPU status=OK value=23.5 duration_ms=1012`
> - Log-Destination: Stdout (default) oder File (via Config)
>
> Teste den kompletten Flow: Agent startet → holt Config → führt Checks aus → batcht Ergebnisse → sendet an Server. Simuliere Server-Ausfall und prüfe dass der Buffer funktioniert.

---

### PROMPT 5 — Windows-Service + Linux-systemd + CLI-Installer

> Implementiere die Service-Integration für Windows und Linux sowie den CLI-Installer.
>
> **Kontext:** Der Agent (Prompts 2-4) funktioniert als Vordergrund-Prozess. Jetzt muss er als System-Service laufen.
>
> **1. Windows-Service (`internal/service/service_windows.go`):**
>
> Verwende `golang.org/x/sys/windows/svc`:
> ```go
> type agentService struct {
>     stopChan chan struct{}
>     agent    *Agent  // Die Main-Loop-Instanz
> }
>
> func (s *agentService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
>     // SERVICE_START_PENDING → SERVICE_RUNNING
>     // Agent starten
>     // Auf SERVICE_STOP warten
>     // Graceful shutdown
>     // SERVICE_STOPPED
> }
> ```
>
> - Service-Name: `OverseerAgent`
> - Display-Name: `Overseer Monitoring Agent`
> - Beschreibung: `Überwacht diesen Computer und sendet Metriken an den Overseer-Server.`
> - Startup-Typ: Automatisch (Delayed Start)
> - Konto: LocalSystem
>
> **2. CLI-Befehle für Windows:**
> - `overseer-agent.exe install --config C:\ProgramData\Overseer\Agent\config.yaml` — Service registrieren
>   - Erstellt Config-Verzeichnis `C:\ProgramData\Overseer\Agent\` falls nicht vorhanden
>   - Registriert Service via `mgr.CreateService()`
>   - Setzt Recovery-Optionen: Neustart nach 60s bei Fehler
> - `overseer-agent.exe uninstall` — Service entfernen
>   - Service stoppen falls läuft
>   - Service deregistrieren
> - `overseer-agent.exe start` — Service starten
> - `overseer-agent.exe stop` — Service stoppen
> - `overseer-agent.exe status` — Service-Status anzeigen
> - `overseer-agent.exe run` — Im Vordergrund ausführen (für Debugging)
> - `overseer-agent.exe version` — Version anzeigen
>
> **3. Automatische Erkennung (Service vs. Vordergrund):**
> - `svc.IsWindowsService()` prüfen
> - Wenn true → als Windows-Service starten
> - Wenn false → als Vordergrund-Prozess starten (Console-Modus)
> - Flag `--run` erzwingt Vordergrund-Modus
>
> **4. Linux-Seite:**
> - Keine spezielle Service-Integration im Go-Code nötig (systemd managed den Prozess)
> - Erstelle `agent/deploy/overseer-agent.service` (systemd Unit File):
>   ```ini
>   [Unit]
>   Description=Overseer Monitoring Agent
>   After=network-online.target
>   Wants=network-online.target
>
>   [Service]
>   Type=simple
>   ExecStart=/usr/local/bin/overseer-agent --config /etc/overseer-agent/config.yaml
>   Restart=always
>   RestartSec=10
>   User=root
>   StandardOutput=journal
>   StandardError=journal
>   SyslogIdentifier=overseer-agent
>
>   [Install]
>   WantedBy=multi-user.target
>   ```
> - Erstelle `agent/deploy/install.sh`:
>   ```bash
>   #!/bin/bash
>   # Installiert den Overseer Agent auf Linux
>   # Usage: curl -sSL https://overseer.example.com/agent/install.sh | bash -s -- <server_url> <agent_token>
>   cp overseer-agent /usr/local/bin/
>   mkdir -p /etc/overseer-agent
>   cat > /etc/overseer-agent/config.yaml <<EOF
>   server: $1
>   token: $2
>   EOF
>   cp overseer-agent.service /etc/systemd/system/
>   systemctl daemon-reload
>   systemctl enable --now overseer-agent
>   ```
>
> **5. Logging auf Windows:**
> - Im Service-Modus: In Windows Event Log schreiben (Application Log, Source: OverseerAgent) — nur für Start/Stop/Fehler Events
> - Detailliertes Log: In Datei `C:\ProgramData\Overseer\Agent\agent.log` (automatisch rotiert: max 10MB, 3 Dateien behalten)
>
> **6. Makefile erweitern:**
> - `make build-windows` mit `-ldflags "-H=windowsgui"` entfernen (Konsolen-App, nicht GUI)
> - `make package-windows`: Erstellt ZIP mit overseer-agent.exe + Beispiel-Config
> - `make package-linux`: Erstellt tar.gz mit Binary + systemd-Unit + install.sh
>
> Teste auf Windows: `overseer-agent.exe install`, `net start OverseerAgent`, prüfe dass er als Service läuft.
> Teste auf Linux: `systemctl start overseer-agent`, prüfe Logs mit `journalctl -u overseer-agent`.

---

### PROMPT 6 — Frontend-Polish, Agent-Download-Seite, Dokumentation

> Finalisiere die Frontend-Integration und erstelle die Dokumentation für den Overseer Agent.
>
> **Kontext:** Agent-Server-Kommunikation (Prompt 1), Go-Agent (Prompts 2-5) sind fertig. Jetzt wird die Benutzerfreundlichkeit und Dokumentation fertiggestellt.
>
> **1. Host-Übersicht (`HostsPage.tsx`):**
> - Agent-Managed-Indikator: Kleines Chip/Badge neben dem Hostnamen (`Agent` in blau/grün) wenn `host.agent_managed === true`
> - Filter-Dropdown: Option "Agent-Hosts" hinzufügen (filtert auf `agent_managed=true`)
>
> **2. Host-Detail Agent-Sektion verbessern:**
> - Wenn Agent online (last_seen < 3min):
>   - Grüner Dot + "Agent online" + "v1.0.0 · Windows · Zuletzt: vor X Minuten"
> - Wenn Agent offline:
>   - Roter Dot + "Agent offline" + "Zuletzt gesehen: <Datum>"
> - Wenn kein Agent:
>   - Grauer Bereich: "Kein Agent eingerichtet"
>   - Button "Agent einrichten" → Dialog mit:
>     1. Token generieren
>     2. Token anzeigen (copy-to-clipboard)
>     3. Installationsanleitung (Tab: Windows / Linux) direkt im Dialog
>     4. Hinweis: "Sobald der Agent sich meldet, erscheint er hier."
>
> **3. Agent-Setup-Dialog (im Host-Detail, nach Token-Generierung):**
>
> **Tab Windows:**
> ```
> 1. overseer-agent.exe herunterladen
> 2. Als Administrator ausführen:
>    overseer-agent.exe install
> 3. Config-Datei bearbeiten:
>    C:\ProgramData\Overseer\Agent\config.yaml
>
>    server: https://overseer.dailycrust.it
>    token: <token>
>
> 4. Service starten:
>    net start OverseerAgent
> ```
>
> **Tab Linux:**
> ```
> 1. Agent herunterladen:
>    wget https://overseer.dailycrust.it/agent/overseer-agent-linux-amd64
> 2. Installieren:
>    chmod +x overseer-agent-linux-amd64
>    sudo mv overseer-agent-linux-amd64 /usr/local/bin/overseer-agent
>    sudo mkdir -p /etc/overseer-agent
> 3. Config erstellen:
>    sudo tee /etc/overseer-agent/config.yaml <<EOF
>    server: https://overseer.dailycrust.it
>    token: <token>
>    EOF
> 4. systemd-Service einrichten:
>    [Anleitung oder Verweis auf install.sh]
> ```
>
> Token im Dialog mit Copy-Button anzeigen (einmalig, danach nur noch "Token aktiv").
>
> **4. Dashboard-Seite (`DashboardPage.tsx`):**
> - Neue Kachel oder Zähler: "X Agents online / Y total" (falls Platz)
>
> **5. API: Agent-Binary-Download (optional aber hilfreich):**
> - Statischen Ordner `/opt/overseer/agent-binaries/` anlegen
> - Nginx-Config: `/agent/overseer-agent-windows-amd64.exe` und `/agent/overseer-agent-linux-amd64` als statische Downloads
> - Oder: API-Endpunkt der die Datei served
>
> **6. Dokumentation (`docs/agent-setup.md`):**
> - Einfache, menschenlesbare Anleitung (Deutsch)
> - Schritt 1: Host in Overseer anlegen
> - Schritt 2: Agent-Token generieren (mit Screenshot-Beschreibung)
> - Schritt 3: Agent installieren (Windows + Linux)
> - Schritt 4: Checks konfigurieren
> - Schritt 5: Prüfen
> - Troubleshooting: Agent meldet sich nicht, Token ungültig, Firewall
>
> **7. CLAUDE.md aktualisieren:**
> - Agent-Architektur dokumentieren
> - Neue Check-Typen (agent_*) auflisten
> - Agent-Token-System erklären
> - Wichtige Design-Entscheidung: "Agent statt WinRM" mit Begründung
>
> **8. Service Templates finalisieren:**
> - "Windows Server (Agent)" Template: ping, rdp (port 3389), agent_cpu, agent_memory, agent_disk(C:)
> - "Linux Server (Agent)" Template: ping, ssh (port 22), agent_cpu, agent_memory, agent_disk(/)
> - Check-Modes der Agent-Checks: `agent`
> - seed_builtin_templates.py aktualisieren und auf Server ausführen
>
> Teste den gesamten Flow End-to-End:
> 1. Host anlegen → Agent-Token generieren
> 2. Agent installieren + Token eintragen
> 3. Agent startet → meldet sich beim Server → Status "Online"
> 4. Checks hinzufügen → Agent holt Config → führt aus → Ergebnisse sichtbar in Overseer
> 5. Agent stoppen → nach 3 Minuten Status "Offline"

---

## Anhang: Skalierungs-Notizen

### Receiver-Kapazität
- Aktuell: 120 req/60s pro Token-Prefix (Redis-basiert)
- Bei 2000 Agents mit 60s-Intervall: max 33 req/s → kein Problem
- Jeder Request enthält gebatchte Ergebnisse (10-50 Checks pro Payload)
- Receiver ist stateless → horizontal skalierbar (mehrere Instanzen hinter Load Balancer)

### Worker-Kapazität
- Batch-Reads: 100 Messages pro Redis XREADGROUP
- Worker-Concurrency: 4 (konfigurierbar)
- In-Memory-Cache eliminiert 3 DB-Queries pro Check
- Bei 333 Results/s: ~3.3 Batches/s → trivial

### DB-Kapazität
- check_results: TimescaleDB Hypertable mit 90-Tage-Retention
- current_status: UPSERT (kein Wachstum, 1 Row pro Service)
- state_history: Nur bei Statuswechsel (selten bei stabilen Systemen)
- Agent-Config-Endpoint: Simple Query (1 JOIN), Agent-seitig 5-Minuten-Cache

### Agent-seitige Kapazität
- Goroutine-Pool: NumCPU Worker (typisch 2-8)
- Memory-Footprint: ~15-30 MB (Go Runtime + Buffers)
- CPU-Footprint: <1% bei normalem Betrieb
- Netzwerk: 1 HTTPS-Request pro Check-Zyklus (gebatcht) + 1 Heartbeat/min + 1 Config/5min

### Optimierungen für >10.000 Agents
1. **Config-Endpoint cachen**: Redis-Cache mit 60s TTL für Agent-Config (Config ändert sich selten)
2. **Receiver horizontal skalieren**: Mehrere Uvicorn-Worker oder Instanzen
3. **Worker horizontal skalieren**: Mehr Consumer in der Consumer Group
4. **DB Connection Pooling**: PgBouncer vorschalten
5. **Heartbeat-Aggregation**: Heartbeats via Redis HSET statt DB-Write (periodischer Flush)
