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

## Lizenz

Proprietär – Interne Nutzung.
