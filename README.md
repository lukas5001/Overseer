# Overseer

**Push-basierte Monitoring-Plattform für Multi-Tenant-Kundenumgebungen.**

Overseer überwacht Server, Switches, Router und andere Hardware über Collector-VMs, die bei jedem Kunden stehen. Die Ergebnisse werden zentral gesammelt, ausgewertet und in einer modernen Weboberfläche dargestellt.

## Architektur

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Collector A  │     │ Collector B  │     │ Collector N  │
│ (Kunde A VM) │     │ (Kunde B VM) │     │ (Kunde N VM) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │ HTTPS POST        │                    │
       └──────────────┬────┘────────────────────┘
                      ▼
              ┌───────────────┐
              │   Receiver    │  ← Validierung, API-Key-Check
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │ Redis Streams  │  ← Message Queue / Puffer
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  Worker Pool   │  ← Schwellwerte, Soft/Hard State
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  PostgreSQL   │  ← Status, Historie, Metriken
              │ + TimescaleDB │
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │  REST API     │  ← FastAPI
              │  + React UI   │  ← Fehlerübersicht, Dashboard
              └───────────────┘
```

## Schnellstart (Entwicklung)

```bash
# 1. Repository klonen
git clone https://github.com/<org>/overseer.git
cd overseer

# 2. Environment einrichten
cp .env.example .env

# 3. Infrastruktur starten
docker compose up -d postgres redis

# 4. Python-Abhängigkeiten installieren
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 5. Datenbank-Schema laden
psql -h localhost -U overseer -d overseer -f migrations/001_initial.sql

# 6. Backend-Services starten (jeweils in eigenem Terminal)
cd receiver && uvicorn app.main:app --reload --port 8001
cd worker && python -m app.main
cd api && uvicorn app.main:app --reload --port 8000

# 7. Frontend starten
cd frontend && npm install && npm run dev

# 8. Collector bauen (Go)
cd collector && go build -o overseer-collector ./cmd/
```

## Projektstruktur

```
overseer/
├── CLAUDE.md              # Projektkontext für Claude Code
├── docker-compose.yml     # Alle Services
├── requirements.txt       # Python-Abhängigkeiten
│
├── collector/             # Go – läuft beim Kunden
│   ├── cmd/main.go
│   └── Dockerfile
│
├── receiver/              # Python/FastAPI – nimmt Check-Ergebnisse an
│   ├── app/main.py
│   └── Dockerfile
│
├── worker/                # Python – verarbeitet Checks aus Redis
│   ├── app/main.py
│   └── Dockerfile
│
├── api/                   # Python/FastAPI – REST API für Frontend
│   ├── app/
│   │   ├── main.py
│   │   └── routers/       # auth, status, tenants, hosts, ...
│   └── Dockerfile
│
├── shared/                # Geteilte Pydantic-Schemas
│   └── schemas/
│
├── frontend/              # React + TypeScript + Vite
│   ├── src/
│   │   ├── pages/         # Dashboard, Fehlerübersicht, ...
│   │   ├── components/    # Layout, wiederverwendbare Komponenten
│   │   └── api/           # Axios Client
│   └── Dockerfile
│
├── migrations/            # SQL-Migrations
├── scripts/               # Hilfsskripte
├── deploy/                # Produktions-Deployment-Configs
└── .github/workflows/     # CI/CD
```

## Technologie-Stack

| Komponente | Technologie |
|-----------|-------------|
| Collector | Go 1.22 |
| Receiver / API | Python 3.12 + FastAPI |
| Worker | Python 3.12 + asyncio |
| Frontend | React 18 + TypeScript + Vite + Tailwind |
| Datenbank | PostgreSQL 16 + TimescaleDB |
| Queue | Redis 7 Streams |
| Container | Docker + Docker Compose |

## Docker Compose (alle Services auf einmal)

```bash
# Alles bauen und starten
docker compose up -d --build

# Schema laden (beim ersten Start)
docker compose exec postgres psql -U overseer -d overseer -f /dev/stdin < migrations/001_initial.sql

# Testdaten einspielen
docker compose exec api python scripts/seed_dev_data.py
```

Frontend: http://localhost:3000
API: http://localhost:8000/docs

## Erstes Login

Nach `seed_dev_data.py`:
- **E-Mail:** `admin@overseer.local`
- **Passwort:** `admin123`

## Collector einrichten

Auf der Kunden-VM (Linux, x86_64):

```bash
# 1. Collector in der DB anlegen (im Frontend: Tenants → API Key generieren)
# 2. Install-Script ausführen
sudo OVERSEER_API_URL=https://overseer.example.com \
     OVERSEER_RECEIVER_URL=https://overseer.example.com \
     OVERSEER_API_KEY=overseer_xxx... \
     OVERSEER_COLLECTOR_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
     bash scripts/install-collector.sh

# 3. Status prüfen
journalctl -u overseer-collector -f
```

Der Collector baut keine Abhängigkeiten – es handelt sich um ein einzelnes Go-Binary.
Bauen für Linux: `cd collector && GOOS=linux GOARCH=amd64 go build -o overseer-collector ./cmd/`

## Rollen

| Rolle | Rechte |
|-------|--------|
| `super_admin` | Alles (Tenants, User, Hosts, Checks) |
| `tenant_admin` | Hosts/Checks anlegen im eigenen Tenant |
| `tenant_operator` | ACK + Downtime setzen |
| `tenant_viewer` | Nur lesen |

## Lizenz

Proprietär – Interne Nutzung.
