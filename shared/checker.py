"""
Overseer Check Executor – Runs network checks (ping, port, HTTP, SSH, SNMP).

Used by:
- Active Check Scheduler (server-side)
- "Check Now" API endpoint
- real_collector.py script
"""
import re
import shlex
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.request


def check_ping(ip: str, **_) -> tuple[str, float | None, str, str]:
    """Real ICMP ping."""
    try:
        result = subprocess.run(
            ["ping", "-c", "3", "-W", "5", ip],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return ("CRITICAL", 0.0, "ms", f"PING CRITICAL - {ip} unreachable")

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
        req.add_header("User-Agent", "Overseer-Checker/1.0")
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
    """Run a command via SSH. Uses key-based auth first, falls back to sshpass."""
    ssh_args = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "LogLevel=ERROR",
        "-o", "BatchMode=yes",
        f"{user}@{ip}", cmd,
    ]
    result = subprocess.run(ssh_args, capture_output=True, text=True, timeout=20)
    if result.returncode == 0:
        return result.stdout.strip()
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


def check_ssh_cpu(ip: str, ssh_user: str = "", ssh_pass: str = "", **_) -> tuple[str, float | None, str, str]:
    """CPU usage via SSH."""
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


def check_ssh_mem(ip: str, ssh_user: str = "", ssh_pass: str = "", **_) -> tuple[str, float | None, str, str]:
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


def check_ssh_disk(ip: str, ssh_user: str = "", ssh_pass: str = "", config: dict = None, **_) -> tuple[str, float | None, str, str]:
    """Disk usage via SSH."""
    mount = (config or {}).get("mount", "/")
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


def check_snmp(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """SNMP GET – fetch a single OID value."""
    import asyncio

    try:
        from pysnmp.hlapi.asyncio import (
            SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity, getCmd,
        )
    except ImportError:
        return ("UNKNOWN", None, "", "SNMP UNKNOWN - pysnmp not installed")

    oid = config.get("oid")
    if not oid:
        return ("UNKNOWN", None, "", "SNMP UNKNOWN - no OID configured")

    community = config.get("community", "public")
    version_str = config.get("version", "2c")
    mp_model = 0 if version_str == "1" else 1  # 0=SNMPv1, 1=SNMPv2c
    scale = float(config.get("scale", 1))
    unit = config.get("unit", "")

    async def _do_get():
        engine = SnmpEngine()
        try:
            result = await getCmd(
                engine,
                CommunityData(community, mpModel=mp_model),
                UdpTransportTarget((ip, 161), timeout=5, retries=1),
                ContextData(),
                ObjectType(ObjectIdentity(oid)),
            )
            return result
        finally:
            engine.closeDispatcher()

    try:
        error_indication, error_status, error_index, var_binds = asyncio.run(_do_get())

        if error_indication:
            return ("UNKNOWN", None, "", f"SNMP UNKNOWN - {error_indication}")
        if error_status:
            return ("UNKNOWN", None, "", f"SNMP UNKNOWN - {error_status.prettyPrint()}")

        for _oid, val in var_binds:
            raw = val.prettyPrint()
            try:
                value = float(raw) * scale
                return ("OK", round(value, 2), unit, f"SNMP OK - {oid} = {value}{unit}")
            except (ValueError, TypeError):
                return ("OK", None, "", f"SNMP OK - {oid} = {raw}")

        return ("UNKNOWN", None, "", "SNMP UNKNOWN - no data returned")
    except Exception as e:
        return ("UNKNOWN", None, "", f"SNMP UNKNOWN - {e}")


def check_snmp_interface(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """SNMP interface status check (ifOperStatus)."""
    if_index = config.get("interface_index", config.get("if_index", "1"))
    oid = f"1.3.6.1.2.1.2.2.1.8.{if_index}"
    snmp_config = {**config, "oid": oid, "scale": "1", "unit": ""}

    status_tuple = check_snmp(ip, snmp_config)
    value = status_tuple[1]

    if value is None:
        return status_tuple  # error already set

    int_val = int(value)
    if int_val == 1:
        return ("OK", int_val, "", f"Interface {if_index} UP")
    elif int_val == 2:
        return ("CRITICAL", int_val, "", f"Interface {if_index} DOWN")
    else:
        return ("WARNING", int_val, "", f"Interface {if_index} status={int_val}")



def check_ssh_command(ip: str, config: dict, ssh_user: str = "", ssh_pass: str = "", **_) -> tuple[str, float | None, str, str]:
    """Arbitrary SSH command with regex matching.

    Config keys:
      command:        Shell command to execute via SSH
      match_regex:    Regex to match against stdout (optional)
      fail_if_match:  If True, CRITICAL when regex matches (default False → CRITICAL when it doesn't)
      extract_value:  Regex with capture group to extract a numeric value (optional)
      value_unit:     Unit for the extracted value (e.g. "s", "%")
    """
    command = config.get("command", "")
    if not command:
        return ("UNKNOWN", None, "", "SSH_COMMAND UNKNOWN - no command configured")

    match_regex = config.get("match_regex", "")
    fail_if_match = config.get("fail_if_match", False)
    extract_value = config.get("extract_value", "")
    value_unit = config.get("value_unit", "")

    try:
        output = _ssh_cmd(ip, ssh_user, ssh_pass, command)

        # Extract numeric value if configured
        value = None
        if extract_value:
            m = re.search(extract_value, output)
            if m and m.group(1):
                try:
                    value = float(m.group(1))
                except (ValueError, IndexError):
                    pass

        # Regex matching for status
        if match_regex:
            matched = bool(re.search(match_regex, output, re.MULTILINE))
            if fail_if_match:
                status = "CRITICAL" if matched else "OK"
            else:
                status = "OK" if matched else "CRITICAL"
        else:
            # No regex: OK if command succeeded (we got here without exception)
            status = "OK"

        return (status, value, value_unit, f"SSH_CMD {status} - {output[:200]}")
    except Exception as e:
        return ("UNKNOWN", None, "", f"SSH_CMD UNKNOWN - {e}")


def check_snmp_string(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """SNMP OID with string/pattern matching.

    Config keys:
      oid:            SNMP OID to query
      community:      SNMP community string (default "public")
      version:        "1" or "2c" (default "2c")
      match_value:    Expected value or regex pattern
      fail_if_match:  If True, CRITICAL when value matches (default False)
      is_regex:       Treat match_value as regex (default False → exact match)
    """
    import asyncio

    try:
        from pysnmp.hlapi.asyncio import (
            SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity, getCmd,
        )
    except ImportError:
        return ("UNKNOWN", None, "", "SNMP_STRING UNKNOWN - pysnmp not installed")

    oid = config.get("oid")
    if not oid:
        return ("UNKNOWN", None, "", "SNMP_STRING UNKNOWN - no OID configured")

    community = config.get("community", "public")
    version_str = config.get("version", "2c")
    mp_model = 0 if version_str == "1" else 1
    match_value = config.get("match_value", "")
    fail_if_match = config.get("fail_if_match", False)
    is_regex = config.get("is_regex", False)

    async def _do_get():
        engine = SnmpEngine()
        try:
            result = await getCmd(
                engine,
                CommunityData(community, mpModel=mp_model),
                UdpTransportTarget((ip, 161), timeout=5, retries=1),
                ContextData(),
                ObjectType(ObjectIdentity(oid)),
            )
            return result
        finally:
            engine.closeDispatcher()

    try:
        error_indication, error_status, error_index, var_binds = asyncio.run(_do_get())

        if error_indication:
            return ("UNKNOWN", None, "", f"SNMP_STRING UNKNOWN - {error_indication}")
        if error_status:
            return ("UNKNOWN", None, "", f"SNMP_STRING UNKNOWN - {error_status.prettyPrint()}")

        for _oid, val in var_binds:
            raw = val.prettyPrint()

            if not match_value:
                return ("OK", None, "", f"SNMP_STRING OK - {oid} = {raw}")

            if is_regex:
                matched = bool(re.search(match_value, raw, re.IGNORECASE))
            else:
                matched = raw.strip() == match_value.strip()

            if fail_if_match:
                status = "CRITICAL" if matched else "OK"
            else:
                status = "OK" if matched else "CRITICAL"

            return (status, None, "", f"SNMP_STRING {status} - {oid} = {raw}")

        return ("UNKNOWN", None, "", "SNMP_STRING UNKNOWN - no data returned")
    except Exception as e:
        return ("UNKNOWN", None, "", f"SNMP_STRING UNKNOWN - {e}")


CHECK_FUNCTIONS = {
    "ping": check_ping,
    "port": check_port,
    "http": check_http,
    "snmp": check_snmp,
    "snmp_interface": check_snmp_interface,
    "snmp_string": check_snmp_string,
    "ssh_cpu": check_ssh_cpu,
    "ssh_mem": check_ssh_mem,
    "ssh_disk": check_ssh_disk,
    "ssh_command": check_ssh_command,
}


def run_check(check_type: str, ip: str, config: dict = None,
              ssh_user: str = "", ssh_pass: str = "") -> dict:
    """Run a single check and return a result dict.

    Returns: {"status", "value", "unit", "message", "check_duration_ms"}
    """
    check_fn = CHECK_FUNCTIONS.get(check_type)
    if not check_fn:
        return {
            "status": "UNKNOWN", "value": None, "unit": "",
            "message": f"Unknown check type: {check_type}",
            "check_duration_ms": 0,
        }

    start = time.time()
    try:
        status, value, unit, message = check_fn(
            ip=ip, config=config or {},
            ssh_user=ssh_user, ssh_pass=ssh_pass,
        )
    except Exception as e:
        status, value, unit, message = "UNKNOWN", None, "", str(e)
    duration_ms = int((time.time() - start) * 1000)

    return {
        "status": status,
        "value": value,
        "unit": unit,
        "message": message,
        "check_duration_ms": duration_ms,
    }
