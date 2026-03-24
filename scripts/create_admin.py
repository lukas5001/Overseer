#!/usr/bin/env python3
"""
Create the initial super_admin user if none exists.

Reads credentials from environment variables or prompts interactively.

Usage:
    python scripts/create_admin.py

    # Non-interactive (e.g. in setup.sh):
    ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret123 python scripts/create_admin.py

Requires: psycopg2-binary, bcrypt
"""
import getpass
import os
import sys
import uuid

import bcrypt
import psycopg2

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://overseer:overseer_dev_password@localhost:5432/overseer",
)


def run():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    # Check if a super_admin already exists
    cur.execute("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")
    if cur.fetchone():
        print("Super-Admin existiert bereits — nichts zu tun.")
        cur.close()
        conn.close()
        return

    # Get credentials from ENV or interactive input
    email = os.getenv("ADMIN_EMAIL")
    password = os.getenv("ADMIN_PASSWORD")
    display_name = os.getenv("ADMIN_DISPLAY_NAME", "Super Admin")

    if not email:
        email = input("Admin E-Mail: ").strip()
    if not password:
        password = getpass.getpass("Admin Passwort: ")
        confirm = getpass.getpass("Passwort bestätigen: ")
        if password != confirm:
            print("Passwörter stimmen nicht überein.")
            sys.exit(1)

    if len(password) < 8:
        print("Passwort muss mindestens 8 Zeichen lang sein.")
        sys.exit(1)

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())

    cur.execute(
        """
        INSERT INTO users (id, email, password_hash, display_name, role, tenant_access, active)
        VALUES (%s, %s, %s, %s, 'super_admin', 'all', true)
        """,
        (user_id, email, password_hash, display_name),
    )
    conn.commit()

    print(f"Super-Admin erstellt: {email} (ID: {user_id})")
    cur.close()
    conn.close()


if __name__ == "__main__":
    run()
