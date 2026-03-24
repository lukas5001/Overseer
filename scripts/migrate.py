#!/usr/bin/env python3
"""
Run all pending SQL migrations against the Overseer database.

Tracks applied migrations in a `migrations_applied` table.
Migrations are executed in filename order (001_, 002_, ...).

Usage:
    python scripts/migrate.py

Requires: psycopg2-binary
"""
import os
import sys
from pathlib import Path

import psycopg2

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://overseer:overseer_dev_password@localhost:5432/overseer",
)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def run():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    # Ensure tracking table exists
    cur.execute("""
        CREATE TABLE IF NOT EXISTS migrations_applied (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    conn.commit()

    # Get already applied migrations
    cur.execute("SELECT filename FROM migrations_applied ORDER BY filename")
    applied = {row[0] for row in cur.fetchall()}

    # Collect migration files
    files = sorted(f for f in MIGRATIONS_DIR.iterdir() if f.suffix == ".sql")

    pending = [f for f in files if f.name not in applied]
    if not pending:
        print("Keine neuen Migrations.")
        cur.close()
        conn.close()
        return

    for f in pending:
        print(f"Applying {f.name} ... ", end="", flush=True)
        sql = f.read_text(encoding="utf-8")
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO migrations_applied (filename) VALUES (%s)",
                (f.name,),
            )
            conn.commit()
            print("OK")
        except Exception as e:
            conn.rollback()
            print(f"FEHLER: {e}")
            sys.exit(1)

    print(f"\n{len(pending)} Migration(s) erfolgreich angewandt.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    run()
