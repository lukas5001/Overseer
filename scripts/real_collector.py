#!/usr/bin/env python3
"""
Real Collector – Performs actual checks against real hosts and sends results
to the Overseer Receiver.

Unlike demo_collector.py (which simulates data), this script performs real
network checks: ping, port, HTTP, SSH-based CPU/RAM/Disk.

Usage:
    python3 scripts/real_collector.py                # run forever, 60s interval
    python3 scripts/real_collector.py --once          # single round
    python3 scripts/real_collector.py --interval 30   # custom interval
"""
import argparse
import json
import os
import shlex
import socket
import subprocess
import ssl
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

import requests

RECEIVER_URL = os.getenv("RECEIVER_URL", "http://localhost:8001/api/v1/results")

# ── Host definitions ──────────────────────────────────────────────────────────

HOSTS = {
    "dailycrust": {
        "tenant_id": "efc716f4-9081-4263-b261-4444efb61339",
        "collector_id": "99055ce7-165b-45e1-9f47-12b81915fdd7",
        "api_key": "overseer_3G-tCXvcKeTWTv1YywDxHXxLOc7WHkX9jKDXJg3IcG0",
        "host": "dailycrust-vps",
        "ip": "212.227.88.119",
        "ssh_user": "root",
        "ssh_pass": "rypWe1H8SLL4A4Ev",
        "checks": [
            {"name": "ping", "check_type": "port", "config": {"port": 443}},  # TCP-ping (ICMP blocked by IONOS)
            {"name": "https_port", "check_type": "port", "config": {"port": 443}},
            {"name": "ssh_port", "check_type": "port", "config": {"port": 22}},
            {"name": "http_check", "check_type": "http", "config": {"url": "https://dailycrust.it"}},
            {"name": "cpu_usage", "check_type": "ssh_cpu", "config": {}},
            {"name": "ram_usage", "check_type": "ssh_mem", "config": {}},
            {"name": "disk_root", "check_type": "ssh_disk", "config": {"mount": "/"}},
        ],
    },
}

# ── Check implementations ─────────────────────────────────────────────────────


def check_ping(ip: str, **_) -> tuple[str, float | None, str, str]:
    """Real ICMP ping."""
    try:
        result = subprocess.run(
            ["ping", "-c", "3", "-W", "5", ip],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return ("CRITICAL", 0.0, "ms", f"PING CRITICAL - {ip} unreachable")

        # Parse avg rtt from "rtt min/avg/max/mdev = 1.234/5.678/9.012/0.345 ms"
        for line in result.stdout.splitlines():
            if "avg" in line and "/" in line:
                parts = line.split("=")[1].strip().split("/")
                avg_ms = float(parts[1])
                if avg_ms > 500:
                    return ("CRITICAL", round(avg_ms, 2), "ms", f"PING CRITICAL - rta={avg_ms:.2f}ms")
                if avg_ms > 200:
                    return ("WARNING", round(avg_ms, 2), "ms", f"PING WARNING - rta={avg_ms:.2f}ms")
                return ("OK", round(avg_ms, 2), "ms", f"PING OK - rta={avg_ms:.2f}ms, 0% packet loss")

        return ("OK", None, "ms", "PING OK")
    except subprocess.TimeoutExpired:
        return ("CRITICAL", 0.0, "ms", f"PING CRITICAL - {ip} timeout")
    except Exception as e:
        return ("UNKNOWN", None, "", f"PING UNKNOWN - {e}")


def check_port(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """TCP port check."""
    port = int(config.get("port", 80))
    try:
        start = time.time()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)
        result = sock.connect_ex((ip, port))
        elapsed = (time.time() - start) * 1000
        sock.close()

        if result == 0:
            return ("OK", round(elapsed, 2), "ms", f"PORT OK - {port} open, {elapsed:.1f}ms")
        else:
            return ("CRITICAL", 0.0, "ms", f"PORT CRITICAL - {port} closed on {ip}")
    except socket.timeout:
        return ("CRITICAL", 0.0, "ms", f"PORT CRITICAL - {port} timeout on {ip}")
    except Exception as e:
        return ("UNKNOWN", None, "", f"PORT UNKNOWN - {e}")


def check_http(config: dict, **_) -> tuple[str, float | None, str, str]:
    """HTTP(S) check."""
    url = config.get("url", "http://localhost")
    try:
        start = time.time()
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, method="GET")
        req.add_header("User-Agent", "Overseer-Collector/1.0")
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            elapsed = (time.time() - start) * 1000
            code = resp.status
            if 200 <= code < 400:
                return ("OK", round(elapsed, 0), "ms", f"HTTP OK - {url} {code}, {elapsed:.0f}ms")
            else:
                return ("WARNING", round(elapsed, 0), "ms", f"HTTP WARNING - {url} returned {code}")
    except urllib.error.HTTPError as e:
        elapsed = (time.time() - start) * 1000
        return ("CRITICAL", round(elapsed, 0), "ms", f"HTTP CRITICAL - {url} returned {e.code}")
    except Exception as e:
        return ("CRITICAL", 0.0, "ms", f"HTTP CRITICAL - {url} {e}")


def _ssh_cmd(ip: str, user: str, password: str, cmd: str) -> str:
    """Run a command via SSH. Uses key-based auth if available, falls back to sshpass."""
    ssh_args = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "LogLevel=ERROR",
        "-o", "BatchMode=yes",
        f"{user}@{ip}", cmd,
    ]
    # Try key-based auth first
    result = subprocess.run(ssh_args, capture_output=True, text=True, timeout=20)
    if result.returncode == 0:
        return result.stdout.strip()
    # Fall back to sshpass if key auth failed and password is provided
    if password:
        full_cmd = [
            "sshpass", "-p", password,
            "ssh", "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=10",
            "-o", "LogLevel=ERROR",
            f"{user}@{ip}", cmd,
        ]
        result = subprocess.run(full_cmd, capture_output=True, text=True, timeout=20)
    if result.returncode != 0:
        raise RuntimeError(f"SSH failed: {result.stderr.strip()}")
    return result.stdout.strip()


def check_ssh_cpu(ip: str, ssh_user: str, ssh_pass: str, **_) -> tuple[str, float | None, str, str]:
    """CPU usage via SSH (reads /proc/stat)."""
    try:
        output = _ssh_cmd(ip, ssh_user, ssh_pass,
                          "top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}'")
        usage = float(output)
        if usage > 95:
            status = "CRITICAL"
        elif usage > 80:
            status = "WARNING"
        else:
            status = "OK"
        return (status, round(usage, 1), "%", f"CPU {status} - usage={usage:.1f}%")
    except Exception as e:
        return ("UNKNOWN", None, "", f"CPU UNKNOWN - {e}")


def check_ssh_mem(ip: str, ssh_user: str, ssh_pass: str, **_) -> tuple[str, float | None, str, str]:
    """RAM usage via SSH."""
    try:
        output = _ssh_cmd(ip, ssh_user, ssh_pass,
                          "free | awk '/Mem:/ {printf \"%.1f\", $3/$2*100}'")
        usage = float(output)
        if usage > 95:
            status = "CRITICAL"
        elif usage > 85:
            status = "WARNING"
        else:
            status = "OK"
        return (status, round(usage, 1), "%", f"RAM {status} - usage={usage:.1f}%")
    except Exception as e:
        return ("UNKNOWN", None, "", f"RAM UNKNOWN - {e}")


def check_ssh_disk(ip: str, ssh_user: str, ssh_pass: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """Disk usage via SSH."""
    mount = config.get("mount", "/")
    try:
        output = _ssh_cmd(ip, ssh_user, ssh_pass,
                          f"df -h {shlex.quote(mount)} | awk 'NR==2 {{print $5}}' | tr -d '%'")
        usage = float(output)
        if usage > 95:
            status = "CRITICAL"
        elif usage > 85:
            status = "WARNING"
        else:
            status = "OK"
        return (status, round(usage, 1), "%", f"DISK {status} - {mount} {usage:.1f}% used")
    except Exception as e:
        return ("UNKNOWN", None, "", f"DISK UNKNOWN - {e}")


CHECK_FUNCTIONS = {
    "ping": check_ping,
    "port": check_port,
    "http": check_http,
    "ssh_cpu": check_ssh_cpu,
    "ssh_mem": check_ssh_mem,
    "ssh_disk": check_ssh_disk,
}

# ── Main loop ──────────────────────────────────────────────────────────────────


def run_checks(host_def: dict) -> list[dict]:
    """Run all checks for a host definition and return check results."""
    ip = host_def["ip"]
    hostname = host_def["host"]
    ssh_user = host_def.get("ssh_user", "")
    ssh_pass = host_def.get("ssh_pass", "")

    results = []
    for chk in host_def["checks"]:
        check_fn = CHECK_FUNCTIONS.get(chk["check_type"])
        if not check_fn:
            results.append({
                "host": hostname, "name": chk["name"], "check_type": chk["check_type"],
                "status": "UNKNOWN", "value": None, "unit": "", "message": f"No checker for {chk['check_type']}",
            })
            continue

        start = time.time()
        try:
            status, value, unit, message = check_fn(
                ip=ip, config=chk.get("config", {}),
                ssh_user=ssh_user, ssh_pass=ssh_pass,
            )
        except Exception as e:
            status, value, unit, message = "UNKNOWN", None, "", str(e)
        duration_ms = int((time.time() - start) * 1000)

        results.append({
            "host": hostname,
            "name": chk["name"],
            "check_type": chk["check_type"],
            "status": status,
            "value": value,
            "unit": unit,
            "message": message,
            "check_duration_ms": duration_ms,
        })
        print(f"    {chk['name']:20s} → {status:8s}  {value if value is not None else '–':>8} {unit}  ({duration_ms}ms)")

    return results


def send_results(host_def: dict, checks: list[dict]) -> bool:
    """Send check results to the Receiver."""
    payload = {
        "collector_id": host_def["collector_id"],
        "tenant_id": host_def["tenant_id"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }
    try:
        resp = requests.post(
            RECEIVER_URL,
            json=payload,
            headers={"X-API-Key": host_def["api_key"]},
            timeout=10,
        )
        return resp.status_code == 202
    except Exception as e:
        print(f"  ✗ Send failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Overseer Real Collector")
    parser.add_argument("--once", action="store_true", help="Run once then exit")
    parser.add_argument("--interval", type=int, default=60, help="Seconds between rounds")
    args = parser.parse_args()

    # Check sshpass is available
    if not subprocess.run(["which", "sshpass"], capture_output=True).returncode == 0:
        print("WARNING: sshpass not installed — SSH-based checks will fail")
        print("Install with: sudo apt install sshpass")

    print(f"Overseer Real Collector")
    print(f"  Receiver: {RECEIVER_URL}")
    print(f"  Hosts:    {', '.join(HOSTS.keys())}")
    print(f"  Interval: {'single run' if args.once else f'{args.interval}s'}")
    print()

    round_num = 0
    while True:
        round_num += 1
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] Round {round_num}")

        for name, host_def in HOSTS.items():
            print(f"  {name} ({host_def['ip']}):")
            checks = run_checks(host_def)
            ok = send_results(host_def, checks)
            ok_count = sum(1 for c in checks if c["status"] == "OK")
            print(f"  → {ok_count}/{len(checks)} OK, sent={'✓' if ok else '✗'}")
            print()

        if args.once:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
