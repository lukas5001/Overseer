#!/usr/bin/env python3
"""
Seed the Overseer database with demo data for development.

Usage:
    python scripts/seed_dev_data.py

Requires: psycopg2-binary (pip install psycopg2-binary)
"""
import hashlib
import os
import secrets
import uuid

import psycopg2
from datetime import datetime, timedelta, timezone

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://overseer:overseer_dev_password@localhost:5432/overseer",
)


def generate_api_key(tenant_slug: str) -> tuple[str, str, str]:
    """Generate an API key, return (full_key, key_hash, key_prefix)."""
    secret = secrets.token_urlsafe(32)
    full_key = f"overseer_{tenant_slug}_{secret}"
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    key_prefix = full_key[:12]
    return full_key, key_hash, key_prefix


def seed():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    print("Seeding Overseer development data...")

    # ==================== Tenants ====================
    tenants = [
        ("Müller GmbH", "mueller-gmbh"),
        ("Schmidt & Partner", "schmidt-partner"),
        ("Technik AG", "technik-ag"),
        ("Beispiel Corp", "beispiel-corp"),
    ]

    tenant_ids = {}
    api_keys = {}
    for name, slug in tenants:
        tid = str(uuid.uuid4())
        tenant_ids[slug] = tid
        cur.execute(
            "INSERT INTO tenants (id, name, slug) VALUES (%s, %s, %s) ON CONFLICT (slug) DO NOTHING",
            (tid, name, slug),
        )

        full_key, key_hash, key_prefix = generate_api_key(slug)
        api_keys[slug] = full_key
        cur.execute(
            "INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name) VALUES (%s, %s, %s, %s)",
            (tid, key_hash, key_prefix, f"Collector Key {slug}"),
        )

    # ==================== Users ====================
    # Password: "admin123" for all dev users
    pw_hash = "$2b$12$LJ3m4ys3Lk0EXAMPLE_HASH_REPLACE_IN_PRODUCTION"

    cur.execute(
        """INSERT INTO users (tenant_id, email, password_hash, display_name, role) 
           VALUES (NULL, 'admin@overseer.local', %s, 'Super Admin', 'super_admin')
           ON CONFLICT (email) DO NOTHING""",
        (pw_hash,),
    )

    for slug, tid in tenant_ids.items():
        cur.execute(
            """INSERT INTO users (tenant_id, email, password_hash, display_name, role) 
               VALUES (%s, %s, %s, %s, 'tenant_admin')
               ON CONFLICT (email) DO NOTHING""",
            (tid, f"admin@{slug}.local", pw_hash, f"Admin {slug}"),
        )

    # ==================== Collectors ====================
    collector_ids = {}
    for slug, tid in tenant_ids.items():
        cid = str(uuid.uuid4())
        collector_ids[slug] = cid
        cur.execute(
            """INSERT INTO collectors (id, tenant_id, name, hostname, ip_address, last_seen_at) 
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (cid, tid, f"collector-{slug}", f"collector-{slug}.local", "10.0.0.100",
             datetime.now(timezone.utc)),
        )

    # ==================== Hosts & Services ====================
    host_configs = {
        "mueller-gmbh": [
            ("switch-core-01", "Core Switch", "192.168.1.1", "switch", [
                ("ping", "ping", {}),
                ("port_count_up", "snmp", {"oid": "1.3.6.1.2.1.2.1.0"}),
                ("cpu_usage", "snmp", {"oid": "1.3.6.1.4.1.9.9.109.1.1.1.1.3.1"}),
            ]),
            ("switch-access-01", "Access Switch Büro", "192.168.1.2", "switch", [
                ("ping", "ping", {}),
                ("port_gi0/1", "snmp", {"oid": "1.3.6.1.2.1.2.2.1.8.1"}),
            ]),
            ("srv-dc-01", "Domain Controller", "192.168.1.10", "server", [
                ("ping", "ping", {}),
                ("cpu_usage", "snmp", {"oid": "1.3.6.1.2.1.25.3.3.1.2"}),
                ("disk_c", "snmp", {"oid": "1.3.6.1.2.1.25.2.3.1.6.1"}),
                ("rdp_port", "port", {"port": 3389}),
            ]),
            ("srv-file-01", "Fileserver", "192.168.1.11", "server", [
                ("ping", "ping", {}),
                ("disk_root", "ssh_disk", {"mount": "/"}),
                ("disk_data", "ssh_disk", {"mount": "/data"}),
                ("smb_port", "port", {"port": 445}),
                ("backup_check", "script", {"command": "/opt/scripts/check_backup.sh"}),
            ]),
            ("fw-01", "Firewall", "192.168.1.254", "firewall", [
                ("ping", "ping", {}),
                ("https_port", "port", {"port": 443}),
            ]),
            ("printer-buero", "Drucker Büro EG", "192.168.1.50", "printer", [
                ("ping", "ping", {}),
                ("toner_level", "snmp", {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.1"}),
            ]),
        ],
        "schmidt-partner": [
            ("switch-main", "Main Switch", "10.10.0.1", "switch", [
                ("ping", "ping", {}),
                ("cpu_usage", "snmp", {}),
            ]),
            ("srv-app-01", "Application Server", "10.10.0.10", "server", [
                ("ping", "ping", {}),
                ("cpu_usage", "ssh_cpu", {}),
                ("ram_usage", "ssh_mem", {}),
                ("disk_root", "ssh_disk", {"mount": "/"}),
                ("webapp_http", "http", {"url": "http://10.10.0.10:8080/health"}),
            ]),
            ("srv-db-01", "Datenbankserver", "10.10.0.11", "server", [
                ("ping", "ping", {}),
                ("mysql_port", "port", {"port": 3306}),
                ("disk_root", "ssh_disk", {"mount": "/"}),
                ("disk_data", "ssh_disk", {"mount": "/var/lib/mysql"}),
            ]),
        ],
        "technik-ag": [
            ("rt-edge-01", "Edge Router", "172.16.0.1", "router", [
                ("ping", "ping", {}),
                ("uplink_status", "snmp", {}),
                ("cpu_usage", "snmp", {}),
            ]),
            ("sw-prod-01", "Production Switch", "172.16.0.2", "switch", [
                ("ping", "ping", {}),
            ]),
            ("srv-erp-01", "ERP Server", "172.16.0.10", "server", [
                ("ping", "ping", {}),
                ("cpu_usage", "ssh_cpu", {}),
                ("ram_usage", "ssh_mem", {}),
                ("erp_http", "http", {"url": "http://172.16.0.10/status"}),
                ("disk_root", "ssh_disk", {"mount": "/"}),
            ]),
        ],
        "beispiel-corp": [
            ("switch-01", "Main Switch", "192.168.10.1", "switch", [
                ("ping", "ping", {}),
            ]),
            ("srv-web-01", "Webserver", "192.168.10.10", "server", [
                ("ping", "ping", {}),
                ("http_check", "http", {"url": "https://192.168.10.10"}),
                ("disk_root", "ssh_disk", {"mount": "/"}),
                ("nginx_process", "ssh_process", {"process": "nginx"}),
            ]),
        ],
    }

    now = datetime.now(timezone.utc)
    for slug, hosts in host_configs.items():
        tid = tenant_ids[slug]
        cid = collector_ids[slug]

        for hostname, display, ip, htype, checks in hosts:
            hid = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO hosts (id, tenant_id, collector_id, hostname, display_name, 
                   ip_address, host_type)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (tenant_id, hostname) DO NOTHING""",
                (hid, tid, cid, hostname, display, ip, htype),
            )

            for check_name, check_type, check_config in checks:
                sid = str(uuid.uuid4())
                import json
                cur.execute(
                    """INSERT INTO services (id, host_id, tenant_id, name, check_type, 
                       check_config, threshold_warn, threshold_crit)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (host_id, name) DO NOTHING""",
                    (sid, hid, tid, check_name, check_type, json.dumps(check_config),
                     80.0 if "cpu" in check_name or "disk" in check_name or "ram" in check_name else None,
                     95.0 if "cpu" in check_name or "disk" in check_name or "ram" in check_name else None),
                )

                # Seed current_status with OK for most, some problems
                import random
                status = "OK"
                message = "Check OK"
                value = None

                # Sprinkle in some problems for realism
                r = random.random()
                if "disk_data" in check_name and slug == "schmidt-partner":
                    status = "CRITICAL"
                    value = 97.2
                    message = "Disk /var/lib/mysql bei 97.2% – fast voll!"
                elif "toner_level" in check_name:
                    status = "WARNING"
                    value = 12.0
                    message = "Toner bei 12%"
                elif "backup_check" in check_name:
                    status = "CRITICAL"
                    value = None
                    message = "Backup fehlgeschlagen: Timeout nach 300s"
                elif "uplink_status" in check_name:
                    status = "WARNING"
                    value = None
                    message = "Uplink Gi0/0 flapping – 3 Statuswechsel in 10min"
                elif r < 0.05:
                    status = "UNKNOWN"
                    message = "Check konnte nicht ausgeführt werden"

                state_type = "HARD"
                state_change = now - timedelta(
                    minutes=random.randint(5, 2880) if status != "OK" else random.randint(60, 43200)
                )

                cur.execute(
                    """INSERT INTO current_status (service_id, host_id, tenant_id, status, 
                       state_type, current_attempt, status_message, value, 
                       last_check_at, last_state_change_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (service_id) DO NOTHING""",
                    (sid, hid, tid, status, state_type, 3 if status != "OK" else 1,
                     message, value, now, state_change),
                )

    conn.commit()
    cur.close()
    conn.close()

    # Print summary
    print("\n✅ Seed complete!\n")
    print("Tenants & API Keys:")
    for slug, key in api_keys.items():
        print(f"  {slug}: {key}")
    print(f"\nSuper Admin: admin@overseer.local")
    print("Password:    admin123 (replace hash in production!)")
    print(f"\nTotal tenants: {len(tenants)}")
    print(f"Total hosts: {sum(len(hosts) for hosts in host_configs.values())}")
    print(f"Total checks: {sum(len(checks) for hosts in host_configs.values() for _, _, _, _, checks in hosts)}")


if __name__ == "__main__":
    seed()
