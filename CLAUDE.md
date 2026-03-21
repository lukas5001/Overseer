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

## Status-Modell

- `OK` (0) – Alles in Ordnung
- `WARNING` (1) – Schwellwert überschritten
- `CRITICAL` (2) – Kritischer Schwellwert überschritten
- `UNKNOWN` (3) – Check konnte nicht ausgeführt werden

## Soft/Hard States

- Check schlägt fehl → Soft State (Zähler hochzählen)
- Nach X aufeinanderfolgenden Fehlschlägen → Hard State
- Nur Hard States erscheinen in der Fehlerübersicht
