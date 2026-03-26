#!/usr/bin/env python3
"""
Seed built-in check templates for Overseer.

Idempotent: safe to run multiple times. Uses UPSERT by (name, built_in=True).

Usage:
    python scripts/seed_builtin_templates.py
"""
import asyncio
import json
import os
import sys

# Allow running from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncpg


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer",
)

# Convert SQLAlchemy URL to asyncpg format
PG_DSN = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


# ═══════════════════════════════════════════════════════════════════════════════
# Template Library
# ═══════════════════════════════════════════════════════════════════════════════

BUILTIN_TEMPLATES = [
    # ── Generic Servers ─────────────────────────────────────────────────────
    {
        "name": "Generic Linux Server",
        "description": "Standard checks for any Linux server: ping, SSH, CPU, RAM, disk.",
        "vendor": "generic",
        "category": "server",
        "tags": ["linux", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "ssh_port", "check_type": "port", "check_config": {"port": 22}, "interval_seconds": 60},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk_root", "check_type": "ssh_disk", "check_config": {"mount": "/"}, "threshold_warn": 80, "threshold_crit": 90, "interval_seconds": 300},
        ],
    },
    {
        "name": "Generic Windows Server",
        "description": "Standard Agent checks for Windows servers: CPU, RAM, Disk C:, automatic services.",
        "vendor": "generic",
        "category": "server",
        "tags": ["windows", "agent"],
        "checks": [
            {"name": "agent_cpu", "check_type": "agent_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 60, "check_mode": "agent"},
            {"name": "agent_memory", "check_type": "agent_memory", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 60, "check_mode": "agent"},
            {"name": "agent_disk", "check_type": "agent_disk", "check_config": {"warn": 80, "crit": 90}, "interval_seconds": 300, "check_mode": "agent"},
            {"name": "agent_services_auto", "check_type": "agent_services_auto", "check_config": {"exclude": ["gupdate", "gupdatem", "sppsvc", "RemoteRegistry"]}, "interval_seconds": 120, "check_mode": "agent"},
        ],
    },
    {
        "name": "Generic Web Application",
        "description": "HTTP/HTTPS availability and response time checks.",
        "vendor": "generic",
        "category": "server",
        "tags": ["http", "web"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "https_port", "check_type": "port", "check_config": {"port": 443}, "interval_seconds": 60},
            {"name": "http_port", "check_type": "port", "check_config": {"port": 80}, "interval_seconds": 60},
            {"name": "http_check", "check_type": "http", "check_config": {"url": "https://{host}"}, "threshold_warn": 3000, "threshold_crit": 10000, "interval_seconds": 60},
        ],
    },
    {
        "name": "Generic Network Device",
        "description": "Basic SNMP monitoring for any network device: ping, uptime, interfaces.",
        "vendor": "generic",
        "category": "switch",
        "tags": ["snmp", "network"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "if1_status", "check_type": "snmp_interface", "check_config": {"interface_index": 1}, "interval_seconds": 60},
        ],
    },

    # ── Cisco ───────────────────────────────────────────────────────────────
    {
        "name": "Cisco IOS Router",
        "description": "SNMP monitoring for Cisco IOS routers: CPU, memory, uptime, interface errors.",
        "vendor": "cisco",
        "category": "router",
        "tags": ["cisco", "snmp", "ios"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_5min", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_used", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.48.1.1.1.5.1", "unit": "bytes"}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "if_in_errors", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.2.2.1.14.1"}, "threshold_warn": 10, "threshold_crit": 100, "interval_seconds": 300},
        ],
    },
    {
        "name": "Cisco Catalyst Switch",
        "description": "SNMP monitoring for Cisco Catalyst switches incl. PoE and interface status.",
        "vendor": "cisco",
        "category": "switch",
        "tags": ["cisco", "snmp", "catalyst", "poe"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_5min", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_free", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.48.1.1.1.6.1", "unit": "bytes"}, "interval_seconds": 120},
            {"name": "poe_power", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.402.1.2.1.9.1", "unit": "W"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 300},
            {"name": "if1_status", "check_type": "snmp_interface", "check_config": {"interface_index": 1}, "interval_seconds": 60},
        ],
    },
    {
        "name": "Cisco ASA Firewall",
        "description": "SNMP monitoring for Cisco ASA: CPU, VPN sessions, failover state.",
        "vendor": "cisco",
        "category": "firewall",
        "tags": ["cisco", "snmp", "asa", "vpn", "failover"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "vpn_sessions", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.9.9.392.1.3.1.0"}, "threshold_warn": 1000, "threshold_crit": 5000, "interval_seconds": 120},
            {"name": "failover_state", "check_type": "snmp_string", "check_config": {"oid": "1.3.6.1.4.1.9.9.147.1.2.1.1.1.2.6", "match_value": "Active"}, "interval_seconds": 60},
        ],
    },

    # ── MikroTik ────────────────────────────────────────────────────────────
    {
        "name": "MikroTik Router",
        "description": "SNMP monitoring for MikroTik RouterOS: CPU, memory, uptime, Winbox port.",
        "vendor": "mikrotik",
        "category": "router",
        "tags": ["mikrotik", "snmp", "routeros"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_load", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.25.3.3.1.2.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_used", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.25.2.3.1.6.65536", "unit": "bytes"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "winbox_port", "check_type": "port", "check_config": {"port": 8291}, "interval_seconds": 120},
        ],
    },
    {
        "name": "MikroTik WireGuard Tunnel",
        "description": "WireGuard tunnel health on MikroTik via SSH: handshake age, interface running state.",
        "vendor": "mikrotik",
        "category": "router",
        "tags": ["mikrotik", "wireguard", "vpn", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "wg_handshake", "check_type": "ssh_command", "check_config": {
                "command": ":foreach i in=[/interface wireguard peers find] do={ :local hs [/interface wireguard peers get $i last-handshake]; :put $hs }",
                "extract_value": "(\\d+)",
                "value_unit": "s"
            }, "threshold_warn": 120, "threshold_crit": 300, "interval_seconds": 60},
            {"name": "wg_interface_up", "check_type": "ssh_command", "check_config": {
                "command": "/interface wireguard print where running",
                "match_regex": "running",
                "fail_if_match": False
            }, "interval_seconds": 60},
        ],
    },
    {
        "name": "MikroTik OSPF Routing",
        "description": "OSPF neighbor state on MikroTik via SSH: neighbor count and Full state.",
        "vendor": "mikrotik",
        "category": "router",
        "tags": ["mikrotik", "ospf", "routing", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "ospf_neighbor", "check_type": "ssh_command", "check_config": {
                "command": "/routing ospf neighbor print count-only",
                "match_regex": "^[1-9][0-9]*$"
            }, "interval_seconds": 120},
            {"name": "ospf_state", "check_type": "ssh_command", "check_config": {
                "command": "/routing ospf neighbor print",
                "match_regex": "Full"
            }, "interval_seconds": 120},
        ],
    },
    {
        "name": "MikroTik IPsec Tunnel",
        "description": "IPsec tunnel status on MikroTik via SSH.",
        "vendor": "mikrotik",
        "category": "router",
        "tags": ["mikrotik", "ipsec", "vpn", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "ipsec_sa", "check_type": "ssh_command", "check_config": {
                "command": "/ip ipsec installed-sa print count-only",
                "match_regex": "^[1-9][0-9]*$"
            }, "interval_seconds": 120},
        ],
    },

    # ── Fortinet ────────────────────────────────────────────────────────────
    {
        "name": "Fortinet FortiGate Firewall",
        "description": "SNMP monitoring for FortiGate: CPU, memory, VPN tunnels, HA state.",
        "vendor": "fortinet",
        "category": "firewall",
        "tags": ["fortinet", "fortigate", "snmp", "vpn", "ha"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.12356.101.4.1.3.0", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.12356.101.4.1.4.0", "unit": "%"}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "vpn_tunnels", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.12356.101.12.2.2.1.20.1"}, "interval_seconds": 120},
            {"name": "ha_member_state", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.12356.101.13.2.1.1.3.1"}, "interval_seconds": 120},
        ],
    },

    # ── Ubiquiti ────────────────────────────────────────────────────────────
    {
        "name": "Ubiquiti UniFi AP",
        "description": "SNMP monitoring for UniFi access points: CPU, client count.",
        "vendor": "ubiquiti",
        "category": "switch",
        "tags": ["ubiquiti", "unifi", "wifi", "snmp"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_load", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.25.3.3.1.2.196608", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "client_count", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.41112.1.6.1.2.1.8.1"}, "threshold_warn": 50, "threshold_crit": 100, "interval_seconds": 120},
        ],
    },
    {
        "name": "Ubiquiti EdgeRouter",
        "description": "SNMP monitoring for Ubiquiti EdgeRouters.",
        "vendor": "ubiquiti",
        "category": "router",
        "tags": ["ubiquiti", "edgerouter", "snmp"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_load", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.25.3.3.1.2.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_used", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.25.2.3.1.6.1"}, "interval_seconds": 120},
        ],
    },

    # ── HP / Aruba ──────────────────────────────────────────────────────────
    {
        "name": "HP/Aruba Switch",
        "description": "SNMP monitoring for HP/Aruba managed switches: CPU, memory, fan, PSU.",
        "vendor": "hp",
        "category": "switch",
        "tags": ["hp", "aruba", "snmp", "poe"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_util", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.6.1", "unit": "%"}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "fan_status", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.11.2.14.11.1.2.6.1.4.1"}, "interval_seconds": 300},
            {"name": "psu_status", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.11.2.14.11.1.2.6.1.4.2"}, "interval_seconds": 300},
        ],
    },

    # ── pfSense / OPNsense ──────────────────────────────────────────────────
    {
        "name": "pfSense / OPNsense",
        "description": "SNMP monitoring for BSD-based firewalls: CPU, memory, WebUI availability.",
        "vendor": "pfsense",
        "category": "firewall",
        "tags": ["pfsense", "opnsense", "snmp", "bsd"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_load_1min", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.2021.10.1.5.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_avail", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.2021.4.6.0", "unit": "kB"}, "interval_seconds": 120},
            {"name": "https_webui", "check_type": "port", "check_config": {"port": 443}, "interval_seconds": 60},
        ],
    },

    # ── Printers ────────────────────────────────────────────────────────────
    {
        "name": "HP Printer",
        "description": "SNMP monitoring for HP printers: toner levels (CMYK), printer status.",
        "vendor": "hp",
        "category": "printer",
        "tags": ["hp", "printer", "snmp", "toner"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 120},
            {"name": "print_port", "check_type": "port", "check_config": {"port": 9100}, "interval_seconds": 120},
            {"name": "toner_black", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.1", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
            {"name": "toner_cyan", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.2", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
            {"name": "toner_magenta", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.3", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
            {"name": "toner_yellow", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.4", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
            {"name": "printer_status", "check_type": "snmp_string", "check_config": {"oid": "1.3.6.1.2.1.25.3.5.1.1.1", "match_value": "3", "fail_if_match": True}, "interval_seconds": 300},
        ],
    },
    {
        "name": "Kyocera Printer",
        "description": "SNMP monitoring for Kyocera printers: toner and drum levels.",
        "vendor": "kyocera",
        "category": "printer",
        "tags": ["kyocera", "printer", "snmp", "toner"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 120},
            {"name": "print_port", "check_type": "port", "check_config": {"port": 9100}, "interval_seconds": 120},
            {"name": "toner_black", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.1347.43.5.1.1.28.1.1", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
            {"name": "drum_remain", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.1347.43.5.1.1.28.1.2", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
        ],
    },
    {
        "name": "Ricoh Printer",
        "description": "SNMP monitoring for Ricoh printers: toner level.",
        "vendor": "ricoh",
        "category": "printer",
        "tags": ["ricoh", "printer", "snmp", "toner"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 120},
            {"name": "print_port", "check_type": "port", "check_config": {"port": 9100}, "interval_seconds": 120},
            {"name": "toner_black", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.367.3.2.1.2.24.1.1.5.1", "unit": "%"}, "threshold_warn": 20, "threshold_crit": 10, "interval_seconds": 3600},
        ],
    },

    # ── UPS ─────────────────────────────────────────────────────────────────
    {
        "name": "APC UPS",
        "description": "SNMP monitoring for APC UPS: battery capacity, runtime, voltage, load, temperature.",
        "vendor": "apc",
        "category": "ups",
        "tags": ["apc", "ups", "snmp", "battery"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 120},
            {"name": "battery_capacity", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.318.1.1.1.2.2.1.0", "unit": "%"}, "threshold_warn": 50, "threshold_crit": 20, "interval_seconds": 300},
            {"name": "battery_runtime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.318.1.1.1.2.2.3.0", "unit": "s", "scale": 0.01}, "threshold_warn": 600, "threshold_crit": 300, "interval_seconds": 300},
            {"name": "input_voltage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.318.1.1.1.3.2.1.0", "unit": "V"}, "threshold_warn": 200, "threshold_crit": 180, "interval_seconds": 60},
            {"name": "output_load", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.318.1.1.1.4.2.3.0", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "battery_temp", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.318.1.1.1.2.2.2.0", "unit": "°C"}, "threshold_warn": 40, "threshold_crit": 50, "interval_seconds": 300},
            {"name": "ups_status", "check_type": "snmp_string", "check_config": {"oid": "1.3.6.1.4.1.318.1.1.1.4.1.1.0", "match_value": "onLine"}, "interval_seconds": 60},
        ],
    },
    {
        "name": "Eaton UPS",
        "description": "SNMP monitoring for Eaton UPS: battery, voltage, load.",
        "vendor": "eaton",
        "category": "ups",
        "tags": ["eaton", "ups", "snmp", "battery"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 120},
            {"name": "battery_status", "check_type": "snmp_string", "check_config": {"oid": "1.3.6.1.4.1.534.1.2.4.0", "match_value": "batteryNormal"}, "interval_seconds": 60},
            {"name": "battery_charge", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.534.1.2.4.0", "unit": "%"}, "threshold_warn": 50, "threshold_crit": 20, "interval_seconds": 300},
            {"name": "input_voltage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.534.1.3.4.1.3.1", "unit": "V"}, "interval_seconds": 60},
            {"name": "output_load", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.534.1.4.4.1.4.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
        ],
    },

    # ── NAS ─────────────────────────────────────────────────────────────────
    {
        "name": "QNAP NAS",
        "description": "SNMP monitoring for QNAP NAS: CPU, memory, volume status, disk health.",
        "vendor": "qnap",
        "category": "nas",
        "tags": ["qnap", "nas", "snmp", "disk"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "webui_port", "check_type": "port", "check_config": {"port": 8080}, "interval_seconds": 120},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.24681.1.2.1.0", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory_free", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.24681.1.2.3.0", "unit": "MB"}, "interval_seconds": 120},
            {"name": "volume_status", "check_type": "snmp_string", "check_config": {"oid": "1.3.6.1.4.1.24681.1.4.1.1.1.1.5.1.3.1", "match_value": "Ready"}, "interval_seconds": 300},
            {"name": "disk1_health", "check_type": "snmp_string", "check_config": {"oid": "1.3.6.1.4.1.24681.1.2.11.1.7.1", "match_value": "GOOD"}, "interval_seconds": 3600},
        ],
    },
    {
        "name": "Synology NAS",
        "description": "SNMP monitoring for Synology DiskStation: CPU, disk status, volume usage.",
        "vendor": "synology",
        "category": "nas",
        "tags": ["synology", "nas", "snmp", "disk"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "dsm_port", "check_type": "port", "check_config": {"port": 5000}, "interval_seconds": 120},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.6574.1.1.0", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk1_status", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.6574.2.1.1.5.1"}, "interval_seconds": 3600},
            {"name": "volume_usage", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.4.1.6574.2.1.1.5.1", "unit": "%"}, "interval_seconds": 300},
        ],
    },

    # ── Linux Services ──────────────────────────────────────────────────────
    {
        "name": "Nginx Web Server",
        "description": "Linux server running Nginx: ports, HTTP check, process status via SSH.",
        "vendor": "generic",
        "category": "server",
        "tags": ["nginx", "web", "linux", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "http_port", "check_type": "port", "check_config": {"port": 80}, "interval_seconds": 60},
            {"name": "https_port", "check_type": "port", "check_config": {"port": 443}, "interval_seconds": 60},
            {"name": "http_check", "check_type": "http", "check_config": {"url": "http://{host}"}, "threshold_warn": 3000, "threshold_crit": 10000, "interval_seconds": 60},
            {"name": "nginx_process", "check_type": "ssh_command", "check_config": {"command": "systemctl is-active nginx", "match_regex": "^active$"}, "interval_seconds": 120},
        ],
    },
    {
        "name": "Apache Web Server",
        "description": "Linux server running Apache: ports, HTTP check, process status via SSH.",
        "vendor": "generic",
        "category": "server",
        "tags": ["apache", "web", "linux", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "http_port", "check_type": "port", "check_config": {"port": 80}, "interval_seconds": 60},
            {"name": "https_port", "check_type": "port", "check_config": {"port": 443}, "interval_seconds": 60},
            {"name": "http_check", "check_type": "http", "check_config": {"url": "http://{host}"}, "threshold_warn": 3000, "threshold_crit": 10000, "interval_seconds": 60},
            {"name": "apache_process", "check_type": "ssh_command", "check_config": {"command": "systemctl is-active apache2 || systemctl is-active httpd", "match_regex": "^active$"}, "interval_seconds": 120},
        ],
    },
    {
        "name": "PostgreSQL Database",
        "description": "PostgreSQL server: port, process, CPU, RAM, disk usage for data directory.",
        "vendor": "generic",
        "category": "server",
        "tags": ["postgresql", "database", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "pg_port", "check_type": "port", "check_config": {"port": 5432}, "interval_seconds": 60},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk_data", "check_type": "ssh_disk", "check_config": {"mount": "/var/lib/postgresql"}, "threshold_warn": 80, "threshold_crit": 90, "interval_seconds": 300},
            {"name": "pg_running", "check_type": "ssh_command", "check_config": {"command": "systemctl is-active postgresql", "match_regex": "^active$"}, "interval_seconds": 120},
        ],
    },
    {
        "name": "MySQL / MariaDB Database",
        "description": "MySQL/MariaDB server: port, process, CPU, RAM, disk.",
        "vendor": "generic",
        "category": "server",
        "tags": ["mysql", "mariadb", "database", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "mysql_port", "check_type": "port", "check_config": {"port": 3306}, "interval_seconds": 60},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk_data", "check_type": "ssh_disk", "check_config": {"mount": "/var/lib/mysql"}, "threshold_warn": 80, "threshold_crit": 90, "interval_seconds": 300},
            {"name": "mysql_running", "check_type": "ssh_command", "check_config": {"command": "systemctl is-active mysql || systemctl is-active mariadb", "match_regex": "^active$"}, "interval_seconds": 120},
        ],
    },

    # ── Virtualization ──────────────────────────────────────────────────────
    {
        "name": "Proxmox VE Host",
        "description": "Proxmox VE hypervisor: WebUI, CPU, RAM, disk, VM count, PVE services.",
        "vendor": "proxmox",
        "category": "server",
        "tags": ["proxmox", "virtualization", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "webui_port", "check_type": "port", "check_config": {"port": 8006}, "interval_seconds": 120},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk_root", "check_type": "ssh_disk", "check_config": {"mount": "/"}, "threshold_warn": 75, "threshold_crit": 90, "interval_seconds": 300},
            {"name": "vm_count", "check_type": "ssh_command", "check_config": {
                "command": "pvesh get /nodes/$(hostname)/qemu --output-format json 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print(len(d))\"",
                "extract_value": "^(\\d+)$", "value_unit": "VMs"
            }, "interval_seconds": 300},
            {"name": "pve_services", "check_type": "ssh_command", "check_config": {
                "command": "systemctl is-active pvedaemon pveproxy | grep -c inactive",
                "match_regex": "^0$"
            }, "interval_seconds": 120},
        ],
    },
    {
        "name": "Docker Host",
        "description": "Linux server running Docker: daemon status, unhealthy containers, CPU, RAM, disk.",
        "vendor": "generic",
        "category": "server",
        "tags": ["docker", "container", "ssh"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk_root", "check_type": "ssh_disk", "check_config": {"mount": "/"}, "threshold_warn": 80, "threshold_crit": 90, "interval_seconds": 300},
            {"name": "docker_running", "check_type": "ssh_command", "check_config": {"command": "systemctl is-active docker", "match_regex": "^active$"}, "interval_seconds": 120},
            {"name": "containers_unhealthy", "check_type": "ssh_command", "check_config": {"command": "docker ps --filter health=unhealthy -q | wc -l", "match_regex": "^0$"}, "interval_seconds": 120},
        ],
    },
    {
        "name": "VMware ESXi Host",
        "description": "Basic SNMP monitoring for VMware ESXi hosts.",
        "vendor": "vmware",
        "category": "server",
        "tags": ["vmware", "esxi", "snmp", "virtualization"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "snmp_uptime", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.1.3.0", "unit": "ticks"}, "interval_seconds": 300},
            {"name": "cpu_load", "check_type": "snmp", "check_config": {"oid": "1.3.6.1.2.1.25.3.3.1.2.1", "unit": "%"}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "esxi_webui", "check_type": "port", "check_config": {"port": 443}, "interval_seconds": 120},
        ],
    },

    # ── Mail Server ─────────────────────────────────────────────────────────
    {
        "name": "Mail Server (SMTP/IMAP)",
        "description": "Mail server monitoring: SMTP, IMAP, submission ports.",
        "vendor": "generic",
        "category": "server",
        "tags": ["mail", "smtp", "imap"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "smtp", "check_type": "port", "check_config": {"port": 25}, "interval_seconds": 60},
            {"name": "submission", "check_type": "port", "check_config": {"port": 587}, "interval_seconds": 60},
            {"name": "imaps", "check_type": "port", "check_config": {"port": 993}, "interval_seconds": 60},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "disk_mail", "check_type": "ssh_disk", "check_config": {"mount": "/var/mail"}, "threshold_warn": 80, "threshold_crit": 90, "interval_seconds": 300},
        ],
    },

    # ── DNS Server ──────────────────────────────────────────────────────────
    {
        "name": "DNS Server",
        "description": "DNS server monitoring: DNS port, CPU, RAM.",
        "vendor": "generic",
        "category": "server",
        "tags": ["dns", "bind", "network"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "dns_tcp", "check_type": "port", "check_config": {"port": 53}, "interval_seconds": 60},
            {"name": "cpu", "check_type": "ssh_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 120},
            {"name": "memory", "check_type": "ssh_mem", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 120},
        ],
    },

    # ── Agent-based Templates ────────────────────────────────────────────
    {
        "name": "Generic Linux Server (Agent)",
        "description": "Linux server monitoring via Overseer Agent: ping, SSH, CPU, RAM, Disk, sshd.",
        "vendor": "generic",
        "category": "server",
        "tags": ["linux", "agent"],
        "checks": [
            {"name": "ping", "check_type": "ping", "check_config": {}, "interval_seconds": 60},
            {"name": "ssh_port", "check_type": "port", "check_config": {"port": 22}, "interval_seconds": 60},
            {"name": "agent_cpu", "check_type": "agent_cpu", "check_config": {}, "threshold_warn": 80, "threshold_crit": 95, "interval_seconds": 60, "check_mode": "agent"},
            {"name": "agent_memory", "check_type": "agent_memory", "check_config": {}, "threshold_warn": 85, "threshold_crit": 95, "interval_seconds": 60, "check_mode": "agent"},
            {"name": "agent_disk", "check_type": "agent_disk", "check_config": {"warn": 80, "crit": 90}, "interval_seconds": 300, "check_mode": "agent"},
            {"name": "agent_sshd", "check_type": "agent_service", "check_config": {"service": "sshd"}, "interval_seconds": 120, "check_mode": "agent"},
        ],
    },
]


# ═══════════════════════════════════════════════════════════════════════════════
# Seed logic
# ═══════════════════════════════════════════════════════════════════════════════

UPSERT_SQL = """
INSERT INTO service_templates (name, description, checks, vendor, category, built_in, tags)
VALUES ($1, $2, $3::jsonb, $4, $5, TRUE, $6::text[])
ON CONFLICT (name) WHERE built_in = TRUE
DO UPDATE SET
    description = EXCLUDED.description,
    checks      = EXCLUDED.checks,
    vendor      = EXCLUDED.vendor,
    category    = EXCLUDED.category,
    tags        = EXCLUDED.tags,
    updated_at  = now()
"""

# We need a partial unique index for the upsert to work
CREATE_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name_built_in
ON service_templates (name) WHERE built_in = TRUE
"""


async def seed():
    conn = await asyncpg.connect(PG_DSN)
    try:
        # Ensure partial unique index exists for upsert
        await conn.execute(CREATE_INDEX_SQL)

        count = 0
        for tpl in BUILTIN_TEMPLATES:
            await conn.execute(
                UPSERT_SQL,
                tpl["name"],
                tpl["description"],
                json.dumps(tpl["checks"]),
                tpl["vendor"],
                tpl["category"],
                tpl["tags"],
            )
            count += 1

        print(f"Seeded {count} built-in templates.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
