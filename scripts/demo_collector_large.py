#!/usr/bin/env python3
"""
Large-scale demo collector for Overseer.
Sends FIXED OK values for all checks – any non-OK status in the dashboard
means the system itself has a problem (worker lag, Redis stau, etc.)

Usage:
    python scripts/demo_collector_large.py                    # run forever (30s)
    python scripts/demo_collector_large.py --once             # single round
    python scripts/demo_collector_large.py --interval 15      # custom interval
    python scripts/demo_collector_large.py --receiver URL     # custom receiver
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import requests

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "large_demo_config.json")
RECEIVER_URL = os.getenv("RECEIVER_URL", "http://localhost:8001/api/v1/results")


# ═══════════════════════════════════════════════════════════════════════════════
# Fixed OK values per check type – deterministic, no randomness
# ═══════════════════════════════════════════════════════════════════════════════

FIXED_VALUES = {
    "ping":         ("OK", 1.5,  "ms", "PING OK - rta=1.50ms, packet loss=0%"),
    "cpu":          ("OK", 22.0, "%",  "CPU OK - usage=22.0%"),
    "ram":          ("OK", 41.0, "%",  "RAM OK - usage=41.0%"),
    "disk":         ("OK", 48.0, "%",  "DISK OK - 48.0% used"),
    "temperature":  ("OK", 34.0, "°C", "TEMP OK - 34.0°C"),
    "port":         ("OK", 1.8,  "ms", "PORT OK - open, response=1.80ms"),
    "http":         ("OK", 120.0,"ms", "HTTP OK - 200 OK, 120ms"),
    "toner":        ("OK", 72.0, "%",  "Toner OK - 72% verbleibend"),
    "backup":       ("OK", 1.0,  "",   "Backup OK - letztes Backup erfolgreich"),
    "process":      ("OK", 3.0,  "procs", "PROCESS OK - running"),
    "battery":      ("OK", 98.0, "%",  "BATTERY OK - 98.0% capacity"),
    "vpn":          ("OK", 5.0,  "tunnels", "VPN OK - 5 tunnel(s) active"),
    "ha":           ("OK", 1.0,  "",   "HA OK - Active/Standby, sync OK"),
    "raid":         ("OK", 1.0,  "",   "RAID OK - Normal"),
    "uptime":       ("OK", 45.0, "days","UPTIME OK - 45 days"),
    "snmp":         ("OK", 42.0, "",   "SNMP OK - value=42.0"),
    "script":       ("OK", 1.0,  "",   "Script OK - completed successfully"),
    "default":      ("OK", 1.0,  "",   "Check OK"),
}


def get_fixed_result(check_name: str, check_type: str) -> tuple:
    """Return fixed OK result based on check name/type."""
    name = check_name.lower()

    if name == "ping":
        return FIXED_VALUES["ping"]
    if "cpu" in name or "load" in name:
        return FIXED_VALUES["cpu"]
    if "ram" in name or "swap" in name:
        return FIXED_VALUES["ram"]
    if any(x in name for x in ("disk", "volume", "aggregate", "datastore", "pool")):
        return FIXED_VALUES["disk"]
    if "toner" in name:
        return FIXED_VALUES["toner"]
    if "temperature" in name or "temp" in name or "humidity" in name:
        return FIXED_VALUES["temperature"]
    if "backup" in name:
        return FIXED_VALUES["backup"]
    if "process" in name or "nginx" in name or "mysql_process" in name or "docker" in name:
        return FIXED_VALUES["process"]
    if "battery" in name:
        return FIXED_VALUES["battery"]
    if "vpn" in name:
        return FIXED_VALUES["vpn"]
    if "ha_status" in name or "vsx" in name or "stack" in name or "cluster" in name:
        return FIXED_VALUES["ha"]
    if "raid" in name:
        return FIXED_VALUES["raid"]
    if "uptime" in name:
        return FIXED_VALUES["uptime"]

    # By check_type
    type_map = {
        "ping": "ping", "ssh_cpu": "cpu", "ssh_mem": "ram", "ssh_disk": "disk",
        "port": "port", "http": "http", "ssh_process": "process", "script": "script",
        "snmp": "snmp",
    }
    key = type_map.get(check_type, "default")
    return FIXED_VALUES[key]


# ═══════════════════════════════════════════════════════════════════════════════
# Sending Logic
# ═══════════════════════════════════════════════════════════════════════════════

def send_tenant(slug: str, info: dict, receiver_url: str) -> tuple[bool, int]:
    """Generate and send all checks for one tenant. Returns (success, count)."""
    checks = []
    for svc in info["services"]:
        status, value, unit, message = get_fixed_result(svc["name"], svc["check_type"])
        checks.append({
            "host": svc["host"],
            "name": svc["name"],
            "status": status,
            "value": value,
            "unit": unit,
            "message": message,
            "check_type": svc["check_type"],
            "check_duration_ms": 50,
        })

    payload = {
        "collector_id": info["collector_id"],
        "tenant_id": info["tenant_id"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }

    try:
        resp = requests.post(
            receiver_url,
            json=payload,
            headers={"X-API-Key": info["api_key"]},
            timeout=30,
        )
        if resp.status_code == 202:
            return True, len(checks)
        else:
            print(f"  ✗ {slug}: HTTP {resp.status_code} - {resp.text[:100]}")
            return False, len(checks)
    except requests.RequestException as e:
        print(f"  ✗ {slug}: {e}")
        return False, len(checks)


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Overseer Large-Scale Demo Collector (Fixed OK)")
    parser.add_argument("--once", action="store_true", help="Run once then exit")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between rounds")
    parser.add_argument("--receiver", default=RECEIVER_URL, help="Receiver URL")
    parser.add_argument("--config", default=CONFIG_PATH, help="Config JSON path")
    parser.add_argument("--threads", type=int, default=4, help="Parallel sender threads")
    args = parser.parse_args()

    if not os.path.exists(args.config):
        print(f"Config not found: {args.config}")
        print("Run seed_large_demo.py first!")
        sys.exit(1)

    with open(args.config) as f:
        config = json.load(f)

    active = {k: v for k, v in config.items() if not v["api_key"].endswith("(existing)")}
    if len(active) < len(config):
        skipped = len(config) - len(active)
        print(f"  Skipping {skipped} tenants with non-recoverable API keys")

    total_services = sum(len(v["services"]) for v in active.values())

    print(f"Overseer Demo Collector (FIXED OK MODE)")
    print(f"  All checks return OK – any problem in dashboard = system issue")
    print(f"  Receiver:  {args.receiver}")
    print(f"  Tenants:   {len(active)}")
    print(f"  Services:  {total_services}")
    print(f"  Threads:   {args.threads}")
    print(f"  Interval:  {'single run' if args.once else f'{args.interval}s'}")
    print()

    round_num = 0
    while True:
        round_num += 1
        t0 = time.time()

        success_count = 0
        total_sent = 0

        with ThreadPoolExecutor(max_workers=args.threads) as pool:
            futures = {
                pool.submit(send_tenant, slug, info, args.receiver): slug
                for slug, info in active.items()
            }
            for future in futures:
                ok_flag, count = future.result()
                if ok_flag:
                    success_count += 1
                total_sent += count

        elapsed = time.time() - t0
        ts = datetime.now().strftime("%H:%M:%S")
        print(
            f"[{ts}] Round {round_num}: "
            f"{success_count}/{len(active)} tenants OK, "
            f"{total_sent} checks sent in {elapsed:.1f}s"
        )

        if args.once:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
