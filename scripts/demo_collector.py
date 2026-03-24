#!/usr/bin/env python3
"""
Demo Collector – Simulates realistic check results for all tenants/hosts/services.

Sends data to the Receiver at regular intervals so the dashboard shows live metrics
with a mix of OK, WARNING, and CRITICAL states.

Usage:
    python3 scripts/demo_collector.py                # run forever, 30s interval
    python3 scripts/demo_collector.py --once          # single round then exit
    python3 scripts/demo_collector.py --interval 10   # custom interval
"""
import argparse
import math
import random
import sys
import time
from datetime import datetime, timezone

import requests

RECEIVER_URL = "http://localhost:8001/api/v1/results"

# Collector definitions: tenant_id, collector_id, API key
COLLECTORS = {
    "beispiel-corp": {
        "tenant_id": "a428af09-1253-4e93-9afb-b43715bb2e19",
        "collector_id": "cfa5f754-9099-460d-966e-6af342f3f4a2",
        "api_key": "overseer_sbXuLcfDkX8NIt8uwQdnIvSYKZGxK-er-l0zs-lPUG4",
    },
    "mueller-gmbh": {
        "tenant_id": "932a670f-6f99-4f12-a4ce-1435b47f2d51",
        "collector_id": "3b4865be-9156-460a-8e88-12a9c11377b8",
        "api_key": "overseer_k2o2kfNTKeQgbkDHiDMvYM_Jv8iiHjQwVZ4uxKq9q2E",
    },
    "schmidt-partner": {
        "tenant_id": "3c9f63b4-4c4c-4936-b587-79c889625f95",
        "collector_id": "29c80f4a-a5dc-4c9a-9e6f-5cfe7125868d",
        "api_key": "overseer_aDVL8lrzDN-dyTv_Sbc760Q4eL5EKgUOqIgbjZm6KPs",
    },
    "technik-ag": {
        "tenant_id": "a81e1e06-9164-418b-91ed-843a1d768d25",
        "collector_id": "4d30193c-5aff-43e1-a010-c4aeb4dfe284",
        "api_key": "overseer_SvNF3D_HNtLD1yFCvT0ZYnv_cR2dFT9uykcJbsqN9_U",
    },
}

# ── Check simulators ──────────────────────────────────────────────────────────
# Each returns (status, value, unit, message)

def _jitter(base: float, pct: float = 0.15) -> float:
    """Add +/- pct jitter to base value."""
    return base * (1 + random.uniform(-pct, pct))


# Persistent state: some services are "problematic" for realism
_problem_hosts: dict[str, dict] = {}

# Deterministic problem hosts — these will consistently generate failures
# so the worker can transition them to HARD state
_FORCED_PROBLEMS = {
    "printer-buero": {"type": "unreachable", "severity": 0.7},  # often offline
    "srv-erp-01": {"type": "cpu", "severity": 0.8},             # CPU always high
    "srv-db-01": {"type": "disk", "severity": 0.9},             # disk nearly full
}

def _get_host_profile(hostname: str) -> dict:
    """Get or create a persistent behaviour profile for a host."""
    if hostname not in _problem_hosts:
        forced = _FORCED_PROBLEMS.get(hostname)
        if forced:
            _problem_hosts[hostname] = {
                "cpu_base": 88 if forced["type"] == "cpu" else random.uniform(20, 40),
                "disk_base": 93 if forced["type"] == "disk" else random.uniform(30, 60),
                "ram_base": 92 if forced["type"] == "ram" else random.uniform(35, 55),
                "is_problematic": True,
                "problem_type": forced["type"],
                "severity": forced["severity"],
            }
        else:
            _problem_hosts[hostname] = {
                "cpu_base": random.uniform(15, 45),
                "disk_base": random.uniform(30, 65),
                "ram_base": random.uniform(35, 60),
                "is_problematic": random.random() < 0.15,
                "problem_type": random.choice(["cpu", "disk", "ram", "unreachable"]),
                "severity": 0.3,
            }
    return _problem_hosts[hostname]


def sim_ping(hostname: str, _config: dict) -> tuple[str, float, str, str]:
    profile = _get_host_profile(hostname)
    sev = profile.get("severity", 0.3)
    if profile["is_problematic"] and profile["problem_type"] == "unreachable" and random.random() < sev:
        return ("CRITICAL", 0.0, "ms", f"PING CRITICAL - {hostname} unreachable (100% packet loss)")

    latency = _jitter(random.uniform(0.5, 15.0))
    if latency > 100:
        return ("CRITICAL", round(latency, 2), "ms", f"PING CRITICAL - rta={latency:.2f}ms")
    if latency > 50:
        return ("WARNING", round(latency, 2), "ms", f"PING WARNING - rta={latency:.2f}ms")
    return ("OK", round(latency, 2), "ms", f"PING OK - rta={latency:.2f}ms, packet loss=0%")


def sim_cpu(hostname: str, _config: dict) -> tuple[str, float, str, str]:
    profile = _get_host_profile(hostname)
    base = profile["cpu_base"]
    if profile["is_problematic"] and profile["problem_type"] == "cpu":
        base = random.uniform(75, 95)
    usage = _jitter(base, 0.2)
    usage = max(1, min(100, usage))

    if usage > 90:
        status = "CRITICAL"
    elif usage > 80:
        status = "WARNING"
    else:
        status = "OK"
    return (status, round(usage, 1), "%", f"CPU {status} - usage={usage:.1f}%")


def sim_disk(hostname: str, config: dict) -> tuple[str, float, str, str]:
    profile = _get_host_profile(hostname)
    mount = config.get("mount", "/")
    base = profile["disk_base"]
    if profile["is_problematic"] and profile["problem_type"] == "disk":
        base = random.uniform(85, 97)
    usage = _jitter(base, 0.05)
    usage = max(5, min(99, usage))

    if usage > 95:
        status = "CRITICAL"
    elif usage > 85:
        status = "WARNING"
    else:
        status = "OK"
    return (status, round(usage, 1), "%", f"DISK {status} - {mount} {usage:.1f}% used")


def sim_ram(hostname: str, _config: dict) -> tuple[str, float, str, str]:
    profile = _get_host_profile(hostname)
    base = profile["ram_base"]
    if profile["is_problematic"] and profile["problem_type"] == "ram":
        base = random.uniform(85, 96)
    usage = _jitter(base, 0.1)
    usage = max(10, min(99, usage))

    if usage > 95:
        status = "CRITICAL"
    elif usage > 85:
        status = "WARNING"
    else:
        status = "OK"
    return (status, round(usage, 1), "%", f"RAM {status} - usage={usage:.1f}%")


def sim_port(hostname: str, config: dict) -> tuple[str, float, str, str]:
    port = config.get("port", 80)
    # 5% chance port is down
    if random.random() < 0.05:
        return ("CRITICAL", 0.0, "", f"PORT CRITICAL - port {port} closed on {hostname}")
    latency = random.uniform(0.1, 5.0)
    return ("OK", round(latency, 2), "ms", f"PORT OK - port {port} open, response={latency:.2f}ms")


def sim_http(hostname: str, config: dict) -> tuple[str, float, str, str]:
    url = config.get("url", f"http://{hostname}")
    # 8% chance of failure
    r = random.random()
    if r < 0.03:
        return ("CRITICAL", 0.0, "ms", f"HTTP CRITICAL - {url} connection refused")
    if r < 0.08:
        code = random.choice([500, 502, 503])
        return ("CRITICAL", 0.0, "ms", f"HTTP CRITICAL - {url} returned {code}")

    resp_time = _jitter(random.uniform(20, 300))
    if resp_time > 2000:
        return ("WARNING", round(resp_time, 0), "ms", f"HTTP WARNING - {url} response time {resp_time:.0f}ms")
    return ("OK", round(resp_time, 0), "ms", f"HTTP OK - {url} 200 OK, {resp_time:.0f}ms")


def sim_snmp(hostname: str, config: dict) -> tuple[str, float, str, str]:
    oid = config.get("oid", "")
    # Generic SNMP value
    value = _jitter(random.uniform(10, 70))
    if value > 90:
        status = "CRITICAL"
    elif value > 75:
        status = "WARNING"
    else:
        status = "OK"
    return (status, round(value, 1), "", f"SNMP {status} - value={value:.1f}")


def sim_process(hostname: str, config: dict) -> tuple[str, float, str, str]:
    process = config.get("process", "unknown")
    # 5% chance process is down
    if random.random() < 0.05:
        return ("CRITICAL", 0.0, "", f"PROCESS CRITICAL - {process} not running on {hostname}")
    procs = random.randint(1, 8)
    return ("OK", float(procs), "procs", f"PROCESS OK - {process}: {procs} process(es) running")


def sim_script(hostname: str, config: dict) -> tuple[str, float, str, str]:
    cmd = config.get("command", "unknown")
    r = random.random()
    if r < 0.1:
        return ("CRITICAL", 0.0, "", f"SCRIPT CRITICAL - {cmd} exited with code 2")
    if r < 0.2:
        return ("WARNING", 0.0, "", f"SCRIPT WARNING - {cmd} exited with code 1")
    return ("OK", 1.0, "", f"SCRIPT OK - {cmd} completed successfully")


SIMULATORS = {
    "ping": sim_ping,
    "ssh_cpu": sim_cpu,
    "ssh_disk": sim_disk,
    "ssh_mem": sim_ram,
    "port": sim_port,
    "http": sim_http,
    "snmp": sim_snmp,
    "ssh_process": sim_process,
    "script": sim_script,
}

# ── Service definitions per tenant ────────────────────────────────────────────

SERVICES = {
    "beispiel-corp": [
        {"host": "srv-web-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "srv-web-01", "name": "disk_root", "check_type": "ssh_disk", "config": {"mount": "/"}},
        {"host": "srv-web-01", "name": "http_check", "check_type": "http", "config": {"url": "https://192.168.10.10"}},
        {"host": "srv-web-01", "name": "nginx_process", "check_type": "ssh_process", "config": {"process": "nginx"}},
        {"host": "switch-01", "name": "ping", "check_type": "ping", "config": {}},
    ],
    "mueller-gmbh": [
        {"host": "srv-dc-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "srv-dc-01", "name": "cpu_usage", "check_type": "snmp", "config": {"oid": "1.3.6.1.2.1.25.3.3.1.2"}},
        {"host": "srv-dc-01", "name": "disk_c", "check_type": "snmp", "config": {"oid": "1.3.6.1.2.1.25.2.3.1.6.1"}},
        {"host": "srv-dc-01", "name": "rdp_port", "check_type": "port", "config": {"port": 3389}},
        {"host": "srv-file-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "srv-file-01", "name": "disk_root", "check_type": "ssh_disk", "config": {"mount": "/"}},
        {"host": "srv-file-01", "name": "disk_data", "check_type": "ssh_disk", "config": {"mount": "/data"}},
        {"host": "srv-file-01", "name": "smb_port", "check_type": "port", "config": {"port": 445}},
        {"host": "srv-file-01", "name": "backup_check", "check_type": "script", "config": {"command": "/opt/scripts/check_backup.sh"}},
        {"host": "fw-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "fw-01", "name": "https_port", "check_type": "port", "config": {"port": 443}},
        {"host": "printer-buero", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "printer-buero", "name": "toner_level", "check_type": "snmp", "config": {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.1"}},
        {"host": "switch-core-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "switch-core-01", "name": "cpu_usage", "check_type": "snmp", "config": {"oid": "1.3.6.1.4.1.9.9.109.1.1.1.1.3.1"}},
        {"host": "switch-core-01", "name": "port_count_up", "check_type": "snmp", "config": {"oid": "1.3.6.1.2.1.2.1.0"}},
        {"host": "switch-access-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "switch-access-01", "name": "port_gi0/1", "check_type": "snmp", "config": {"oid": "1.3.6.1.2.1.2.2.1.8.1"}},
    ],
    "schmidt-partner": [
        {"host": "srv-app-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "srv-app-01", "name": "cpu_usage", "check_type": "ssh_cpu", "config": {}},
        {"host": "srv-app-01", "name": "ram_usage", "check_type": "ssh_mem", "config": {}},
        {"host": "srv-app-01", "name": "disk_root", "check_type": "ssh_disk", "config": {"mount": "/"}},
        {"host": "srv-app-01", "name": "webapp_http", "check_type": "http", "config": {"url": "http://10.10.0.10:8080/health"}},
        {"host": "srv-db-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "srv-db-01", "name": "disk_root", "check_type": "ssh_disk", "config": {"mount": "/"}},
        {"host": "srv-db-01", "name": "disk_data", "check_type": "ssh_disk", "config": {"mount": "/var/lib/mysql"}},
        {"host": "srv-db-01", "name": "mysql_port", "check_type": "port", "config": {"port": 3306}},
        {"host": "switch-main", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "switch-main", "name": "cpu_usage", "check_type": "snmp", "config": {}},
    ],
    "technik-ag": [
        {"host": "srv-erp-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "srv-erp-01", "name": "cpu_usage", "check_type": "ssh_cpu", "config": {}},
        {"host": "srv-erp-01", "name": "ram_usage", "check_type": "ssh_mem", "config": {}},
        {"host": "srv-erp-01", "name": "disk_root", "check_type": "ssh_disk", "config": {"mount": "/"}},
        {"host": "srv-erp-01", "name": "erp_http", "check_type": "http", "config": {"url": "http://172.16.0.10/status"}},
        {"host": "rt-edge-01", "name": "ping", "check_type": "ping", "config": {}},
        {"host": "rt-edge-01", "name": "cpu_usage", "check_type": "snmp", "config": {}},
        {"host": "rt-edge-01", "name": "uplink_status", "check_type": "snmp", "config": {}},
        {"host": "sw-prod-01", "name": "ping", "check_type": "ping", "config": {}},
    ],
}


def generate_checks(tenant_name: str) -> list[dict]:
    """Generate simulated check results for all services of a tenant."""
    checks = []
    for svc in SERVICES[tenant_name]:
        simulator = SIMULATORS.get(svc["check_type"], sim_ping)
        status, value, unit, message = simulator(svc["host"], svc["config"])
        checks.append({
            "host": svc["host"],
            "name": svc["name"],
            "status": status,
            "value": value,
            "unit": unit,
            "message": message,
            "check_type": svc["check_type"],
            "check_duration_ms": random.randint(5, 500),
        })
    return checks


def send_batch(tenant_name: str) -> bool:
    """Send a batch of check results for one tenant. Returns True on success."""
    info = COLLECTORS[tenant_name]
    checks = generate_checks(tenant_name)

    payload = {
        "collector_id": info["collector_id"],
        "tenant_id": info["tenant_id"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }

    try:
        resp = requests.post(
            RECEIVER_URL,
            json=payload,
            headers={"X-API-Key": info["api_key"]},
            timeout=10,
        )
        if resp.status_code == 202:
            ok_count = sum(1 for c in checks if c["status"] == "OK")
            warn_count = sum(1 for c in checks if c["status"] == "WARNING")
            crit_count = sum(1 for c in checks if c["status"] == "CRITICAL")
            print(f"  ✓ {tenant_name}: {len(checks)} checks sent "
                  f"(OK={ok_count} WARN={warn_count} CRIT={crit_count})")
            return True
        else:
            print(f"  ✗ {tenant_name}: HTTP {resp.status_code} - {resp.text[:200]}")
            return False
    except requests.RequestException as e:
        print(f"  ✗ {tenant_name}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Overseer Demo Collector")
    parser.add_argument("--once", action="store_true", help="Run once then exit")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between rounds (default: 30)")
    args = parser.parse_args()

    print(f"Overseer Demo Collector")
    print(f"  Receiver: {RECEIVER_URL}")
    print(f"  Tenants:  {', '.join(COLLECTORS.keys())}")
    print(f"  Services: {sum(len(v) for v in SERVICES.values())} total")
    print(f"  Interval: {'single run' if args.once else f'{args.interval}s'}")
    print()

    round_num = 0
    while True:
        round_num += 1
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] Round {round_num}")

        success = 0
        for tenant_name in COLLECTORS:
            if send_batch(tenant_name):
                success += 1

        print(f"  → {success}/{len(COLLECTORS)} tenants OK")
        print()

        if args.once:
            break

        time.sleep(args.interval)


if __name__ == "__main__":
    main()
