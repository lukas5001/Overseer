"""
Overseer Check Executor – Runs network checks (ping, port, HTTP, SSH).

Used by:
- Active Check Scheduler (server-side)
- "Check Now" API endpoint
- real_collector.py script
"""
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



# ── WinRM checks (Windows Server via PowerShell Remoting) ──────────────────────

def _winrm_run(ip: str, config: dict, ps_script: str) -> str:
    """Run a PowerShell command on a Windows host via WinRM. Returns stdout."""
    try:
        import winrm
    except ImportError:
        raise RuntimeError("pywinrm not installed – pip install pywinrm")

    username = config.get("username", "")
    password = config.get("password", "")
    transport = config.get("transport", "ntlm")
    port = int(config.get("port", 5986))
    use_ssl = str(config.get("ssl", "true")).lower() in ("true", "1", "yes")
    verify_ssl = str(config.get("verify_ssl", "false")).lower() in ("true", "1", "yes")

    if not username or not password:
        raise RuntimeError("WinRM: username und password erforderlich")

    scheme = "https" if use_ssl else "http"
    endpoint = f"{scheme}://{ip}:{port}/wsman"

    session = winrm.Session(
        endpoint,
        auth=(username, password),
        transport=transport,
        server_cert_validation="validate" if verify_ssl else "ignore",
        read_timeout_sec=15,
        operation_timeout_sec=10,
    )

    result = session.run_ps(ps_script)
    if result.status_code != 0:
        stderr = result.std_err.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"PowerShell error: {stderr[:200]}")
    return result.std_out.decode("utf-8", errors="replace").strip()


def check_winrm_cpu(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """CPU usage via WinRM (Get-CimInstance)."""
    try:
        output = _winrm_run(ip, config,
            "(Get-CimInstance Win32_Processor | "
            "Measure-Object -Property LoadPercentage -Average).Average")
        usage = float(output)
        if usage > 95:
            status = "CRITICAL"
        elif usage > 80:
            status = "WARNING"
        else:
            status = "OK"
        return (status, round(usage, 1), "%", f"CPU {status} - usage={usage:.1f}%")
    except Exception as e:
        return ("UNKNOWN", None, "", f"WinRM CPU UNKNOWN - {e}")


def check_winrm_mem(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """RAM usage via WinRM."""
    try:
        output = _winrm_run(ip, config, """
$os = Get-CimInstance Win32_OperatingSystem
$used = $os.TotalVisibleMemorySize - $os.FreePhysicalMemory
[math]::Round($used / $os.TotalVisibleMemorySize * 100, 1)
""")
        usage = float(output)
        if usage > 95:
            status = "CRITICAL"
        elif usage > 85:
            status = "WARNING"
        else:
            status = "OK"
        return (status, round(usage, 1), "%", f"RAM {status} - usage={usage:.1f}%")
    except Exception as e:
        return ("UNKNOWN", None, "", f"WinRM RAM UNKNOWN - {e}")


def check_winrm_disk(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """Disk usage via WinRM (specific drive letter)."""
    drive = config.get("drive", "C:")
    if not drive.endswith(":"):
        drive += ":"
    try:
        import json as _json
        output = _winrm_run(ip, config, f"""
$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='{drive}'"
if (-not $d) {{ Write-Error "Drive {drive} not found"; exit 1 }}
@{{
    used_pct = [math]::Round(($d.Size - $d.FreeSpace) / $d.Size * 100, 1)
    free_gb  = [math]::Round($d.FreeSpace / 1GB, 2)
    size_gb  = [math]::Round($d.Size / 1GB, 2)
}} | ConvertTo-Json
""")
        data = _json.loads(output)
        usage = float(data["used_pct"])
        free_gb = data["free_gb"]
        size_gb = data["size_gb"]
        if usage > 95:
            status = "CRITICAL"
        elif usage > 85:
            status = "WARNING"
        else:
            status = "OK"
        return (status, round(usage, 1), "%",
                f"DISK {status} - {drive} {usage:.1f}% used ({free_gb} GB frei / {size_gb} GB)")
    except Exception as e:
        return ("UNKNOWN", None, "", f"WinRM DISK UNKNOWN - {e}")


def check_winrm_service(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """Windows service status via WinRM."""
    service = config.get("service", "")
    if not service:
        return ("UNKNOWN", None, "", "WinRM SERVICE - kein Servicename konfiguriert")
    try:
        output = _winrm_run(ip, config, f"""
$svc = Get-Service -Name '{service}' -ErrorAction SilentlyContinue
if (-not $svc) {{ Write-Output "NOT_FOUND"; exit 0 }}
Write-Output $svc.Status
""")
        svc_status = output.strip().upper()
        if svc_status == "NOT_FOUND":
            return ("UNKNOWN", None, "", f"Service '{service}' nicht gefunden")
        if svc_status == "RUNNING":
            return ("OK", 1, "", f"Service '{service}' läuft")
        elif svc_status == "STOPPED":
            return ("CRITICAL", 0, "", f"Service '{service}' gestoppt")
        else:
            return ("WARNING", None, "", f"Service '{service}' Status: {svc_status}")
    except Exception as e:
        return ("UNKNOWN", None, "", f"WinRM SERVICE UNKNOWN - {e}")


def check_winrm_custom(ip: str, config: dict, **_) -> tuple[str, float | None, str, str]:
    """Custom PowerShell command via WinRM.

    Config keys:
      command:  PowerShell script to execute
      ok_pattern:   regex – if stdout matches → OK (optional)
      crit_pattern: regex – if stdout matches → CRITICAL (optional)
    """
    import re
    command = config.get("command", "")
    if not command:
        return ("UNKNOWN", None, "", "WinRM CUSTOM - kein Kommando konfiguriert")
    try:
        output = _winrm_run(ip, config, command)

        # Try to extract a numeric value from the output
        value = None
        numbers = re.findall(r"[-+]?\d+\.?\d*", output)
        if numbers:
            value = float(numbers[0])

        # Pattern matching for status
        crit_pattern = config.get("crit_pattern", "")
        ok_pattern = config.get("ok_pattern", "")
        if crit_pattern and re.search(crit_pattern, output, re.IGNORECASE):
            return ("CRITICAL", value, "", f"CRITICAL - {output[:200]}")
        if ok_pattern and re.search(ok_pattern, output, re.IGNORECASE):
            return ("OK", value, "", f"OK - {output[:200]}")

        # Default: non-empty output = OK
        if output:
            return ("OK", value, "", output[:200])
        return ("WARNING", None, "", "Keine Ausgabe vom Kommando")
    except Exception as e:
        return ("UNKNOWN", None, "", f"WinRM CUSTOM UNKNOWN - {e}")


CHECK_FUNCTIONS = {
    "ping": check_ping,
    "port": check_port,
    "http": check_http,
    "snmp": check_snmp,
    "snmp_interface": check_snmp_interface,
    "ssh_cpu": check_ssh_cpu,
    "ssh_mem": check_ssh_mem,
    "ssh_disk": check_ssh_disk,
    "winrm_cpu": check_winrm_cpu,
    "winrm_mem": check_winrm_mem,
    "winrm_disk": check_winrm_disk,
    "winrm_service": check_winrm_service,
    "winrm_custom": check_winrm_custom,
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
