#!/bin/bash
set -euo pipefail

echo "=== Overseer Setup ==="

# 1. Prüfe ob .env existiert
if [ ! -f .env ]; then
    cp .env.example .env
    echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" >> .env
    echo "FIELD_ENCRYPTION_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" >> .env
    echo ".env erstellt — bitte POSTGRES_PASSWORD, SMTP_* und andere Werte eintragen."
    exit 1
fi

# 2. Docker-Compose hochfahren (nur Infra)
docker compose up -d postgres redis

# 3. Auf DB warten
echo "Warte auf PostgreSQL..."
until docker compose exec postgres pg_isready -U overseer; do sleep 1; done

# 4. Migrations ausführen
python3 scripts/migrate.py

# 5. Admin-User erstellen (falls nicht vorhanden)
python3 scripts/create_admin.py

echo "=== Setup abgeschlossen ==="
