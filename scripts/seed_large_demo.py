#!/usr/bin/env python3
"""
Large-scale demo seeder for Overseer.
Creates ~25 tenants with ~10,000 service checks across realistic device types
(Synology, QNAP, NetApp, SonicWall, Fortinet, Windows, Linux, Cisco, HP, Aruba, etc.)

Usage:
    python scripts/seed_large_demo.py                    # seed (additive)
    python scripts/seed_large_demo.py --clean            # wipe + reseed
    python scripts/seed_large_demo.py --db-url URL       # custom DB

Outputs: scripts/large_demo_config.json (for demo_collector_large.py)
"""
import argparse
import hashlib
import json
import os
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import psycopg2

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://overseer:overseer_dev_password@localhost:5432/overseer",
)

# ═══════════════════════════════════════════════════════════════════════════════
# Device Check Templates
# Each: (host_type, [(check_name, check_type, check_config, warn, crit), ...])
# ═══════════════════════════════════════════════════════════════════════════════

DEVICES = {
    # ── Firewalls ──────────────────────────────────────────────────────────────
    "fortinet_small": ("firewall", [
        ("ping", "ping", {}, None, None),
        ("https_mgmt", "port", {"port": 443}, None, None),
        ("cpu_usage", "snmp", {"oid": "1.3.6.1.4.1.12356.101.4.1.3.0"}, 80, 95),
        ("ram_usage", "snmp", {"oid": "1.3.6.1.4.1.12356.101.4.1.4.0"}, 85, 95),
        ("session_count", "snmp", {"oid": "1.3.6.1.4.1.12356.101.4.1.8.0"}, None, None),
        ("vpn_tunnels", "snmp", {"oid": "1.3.6.1.4.1.12356.101.12.2.2.1.20"}, None, None),
        ("uptime", "snmp", {"oid": "1.3.6.1.2.1.1.3.0"}, None, None),
    ]),
    "fortinet_ha": ("firewall", [
        ("ping", "ping", {}, None, None),
        ("https_mgmt", "port", {"port": 443}, None, None),
        ("cpu_usage", "snmp", {"oid": "1.3.6.1.4.1.12356.101.4.1.3.0"}, 80, 95),
        ("ram_usage", "snmp", {"oid": "1.3.6.1.4.1.12356.101.4.1.4.0"}, 85, 95),
        ("session_count", "snmp", {}, None, None),
        ("vpn_tunnels", "snmp", {}, None, None),
        ("ha_status", "snmp", {"oid": "1.3.6.1.4.1.12356.101.13.2.1.1.1"}, None, None),
        ("disk_usage", "snmp", {}, 80, 90),
        ("throughput_in", "snmp", {}, None, None),
        ("throughput_out", "snmp", {}, None, None),
        ("ips_events", "snmp", {}, None, None),
        ("uptime", "snmp", {"oid": "1.3.6.1.2.1.1.3.0"}, None, None),
    ]),
    "sonicwall": ("firewall", [
        ("ping", "ping", {}, None, None),
        ("https_mgmt", "port", {"port": 443}, None, None),
        ("cpu_usage", "snmp", {"oid": "1.3.6.1.4.1.8741.1.3.1.3.0"}, 80, 95),
        ("ram_usage", "snmp", {"oid": "1.3.6.1.4.1.8741.1.3.1.4.0"}, 85, 95),
        ("connections", "snmp", {}, None, None),
        ("vpn_tunnels", "snmp", {}, None, None),
        ("throughput", "snmp", {}, None, None),
        ("uptime", "snmp", {"oid": "1.3.6.1.2.1.1.3.0"}, None, None),
    ]),

    # ── Switches ───────────────────────────────────────────────────────────────
    "cisco_switch": ("switch", [
        ("ping", "ping", {}, None, None),
        ("cpu_usage", "snmp", {"oid": "1.3.6.1.4.1.9.9.109.1.1.1.1.3.1"}, 80, 95),
        ("ram_usage", "snmp", {"oid": "1.3.6.1.4.1.9.9.48.1.1.1.5.1"}, 85, 95),
        ("temperature", "snmp", {"oid": "1.3.6.1.4.1.9.9.13.1.3.1.3.1"}, 55, 70),
        ("fan_status", "snmp", {"oid": "1.3.6.1.4.1.9.9.13.1.4.1.3.1"}, None, None),
        ("uplink_1", "snmp", {"oid": "1.3.6.1.2.1.2.2.1.8.1"}, None, None),
        ("uplink_2", "snmp", {"oid": "1.3.6.1.2.1.2.2.1.8.2"}, None, None),
        ("port_count_up", "snmp", {"oid": "1.3.6.1.2.1.2.1.0"}, None, None),
        ("poe_budget", "snmp", {"oid": "1.3.6.1.2.1.105.1.3.1.1.4"}, None, None),
        ("stp_changes", "snmp", {"oid": "1.3.6.1.2.1.17.2.6.0"}, None, None),
    ]),
    "hp_switch": ("switch", [
        ("ping", "ping", {}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("temperature", "snmp", {}, 55, 70),
        ("uplink_1", "snmp", {}, None, None),
        ("uplink_2", "snmp", {}, None, None),
        ("port_count_up", "snmp", {}, None, None),
        ("poe_power", "snmp", {}, None, None),
        ("stack_status", "snmp", {}, None, None),
    ]),
    "aruba_switch": ("switch", [
        ("ping", "ping", {}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("temperature", "snmp", {}, 55, 70),
        ("uplink_1", "snmp", {}, None, None),
        ("port_count_up", "snmp", {}, None, None),
        ("poe_budget", "snmp", {}, None, None),
        ("vsx_status", "snmp", {}, None, None),
    ]),

    # ── Access Points ──────────────────────────────────────────────────────────
    "aruba_ap": ("access_point", [
        ("ping", "ping", {}, None, None),
        ("client_count", "snmp", {}, None, None),
        ("channel_util_2g", "snmp", {}, 70, 90),
        ("channel_util_5g", "snmp", {}, 70, 90),
        ("cpu_usage", "snmp", {}, 80, 95),
    ]),

    # ── Windows Servers ────────────────────────────────────────────────────────
    "windows_dc": ("server", [
        ("ping", "ping", {}, None, None),
        ("rdp_port", "port", {"port": 3389}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_c", "snmp", {}, 85, 95),
        ("disk_d", "snmp", {}, 85, 95),
        ("uptime", "snmp", {}, None, None),
        ("ad_replication", "script", {"command": "repadmin /replsummary"}, None, None),
        ("dns_service", "port", {"port": 53}, None, None),
        ("dhcp_service", "script", {"command": "Get-DhcpServerv4Scope"}, None, None),
        ("cert_expiry", "script", {"command": "certutil -store"}, None, None),
        ("eventlog_errors", "script", {"command": "Get-EventLog -LogName System"}, None, None),
    ]),
    "windows_file": ("server", [
        ("ping", "ping", {}, None, None),
        ("rdp_port", "port", {"port": 3389}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_c", "snmp", {}, 85, 95),
        ("disk_d", "snmp", {}, 85, 95),
        ("disk_e", "snmp", {}, 85, 95),
        ("smb_port", "port", {"port": 445}, None, None),
        ("backup_status", "script", {"command": "veeam_check.ps1"}, None, None),
        ("shadow_copies", "script", {"command": "vssadmin list shadows"}, None, None),
    ]),
    "windows_app": ("server", [
        ("ping", "ping", {}, None, None),
        ("rdp_port", "port", {"port": 3389}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_c", "snmp", {}, 85, 95),
        ("disk_d", "snmp", {}, 85, 95),
        ("app_http", "http", {"url": "http://localhost/health"}, None, None),
        ("uptime", "snmp", {}, None, None),
        ("backup_status", "script", {"command": "veeam_check.ps1"}, None, None),
    ]),
    "windows_exchange": ("server", [
        ("ping", "ping", {}, None, None),
        ("rdp_port", "port", {"port": 3389}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_c", "snmp", {}, 85, 95),
        ("disk_d", "snmp", {}, 85, 95),
        ("disk_e", "snmp", {}, 85, 95),
        ("smtp_port", "port", {"port": 25}, None, None),
        ("https_owa", "http", {"url": "https://localhost/owa"}, None, None),
        ("mail_queue", "script", {"command": "Get-Queue"}, None, None),
        ("dag_health", "script", {"command": "Test-ReplicationHealth"}, None, None),
        ("cert_expiry", "script", {"command": "certutil -store"}, None, None),
        ("backup_status", "script", {"command": "veeam_check.ps1"}, None, None),
    ]),
    "windows_sql": ("server", [
        ("ping", "ping", {}, None, None),
        ("rdp_port", "port", {"port": 3389}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_c", "snmp", {}, 85, 95),
        ("disk_d", "snmp", {}, 85, 95),
        ("disk_e", "snmp", {}, 85, 95),
        ("mssql_port", "port", {"port": 1433}, None, None),
        ("db_connections", "script", {"command": "check_mssql_connections.ps1"}, None, None),
        ("backup_status", "script", {"command": "veeam_check.ps1"}, None, None),
        ("agent_jobs", "script", {"command": "check_sql_agent.ps1"}, None, None),
    ]),
    "windows_rdsh": ("server", [
        ("ping", "ping", {}, None, None),
        ("rdp_port", "port", {"port": 3389}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_c", "snmp", {}, 85, 95),
        ("active_sessions", "script", {"command": "query session"}, None, None),
        ("uptime", "snmp", {}, None, None),
        ("cert_expiry", "script", {"command": "certutil -store"}, None, None),
    ]),

    # ── Linux Servers ──────────────────────────────────────────────────────────
    "linux_basic": ("server", [
        ("ping", "ping", {}, None, None),
        ("ssh_port", "port", {"port": 22}, None, None),
        ("cpu_usage", "ssh_cpu", {}, 80, 95),
        ("ram_usage", "ssh_mem", {}, 85, 95),
        ("disk_root", "ssh_disk", {"mount": "/"}, 85, 95),
        ("load_avg", "ssh_cpu", {}, None, None),
        ("swap_usage", "ssh_mem", {}, 50, 80),
    ]),
    "linux_web": ("server", [
        ("ping", "ping", {}, None, None),
        ("ssh_port", "port", {"port": 22}, None, None),
        ("cpu_usage", "ssh_cpu", {}, 80, 95),
        ("ram_usage", "ssh_mem", {}, 85, 95),
        ("disk_root", "ssh_disk", {"mount": "/"}, 85, 95),
        ("disk_var", "ssh_disk", {"mount": "/var"}, 85, 95),
        ("http_check", "http", {"url": "http://localhost"}, None, None),
        ("ssl_cert_expiry", "script", {"command": "check_ssl_cert.sh"}, None, None),
        ("nginx_process", "ssh_process", {"process": "nginx"}, None, None),
        ("load_avg", "ssh_cpu", {}, None, None),
    ]),
    "linux_db": ("server", [
        ("ping", "ping", {}, None, None),
        ("ssh_port", "port", {"port": 22}, None, None),
        ("cpu_usage", "ssh_cpu", {}, 80, 95),
        ("ram_usage", "ssh_mem", {}, 85, 95),
        ("disk_root", "ssh_disk", {"mount": "/"}, 85, 95),
        ("disk_data", "ssh_disk", {"mount": "/var/lib/mysql"}, 85, 95),
        ("mysql_port", "port", {"port": 3306}, None, None),
        ("mysql_process", "ssh_process", {"process": "mysqld"}, None, None),
        ("db_connections", "script", {"command": "check_mysql_connections.sh"}, None, None),
        ("backup_status", "script", {"command": "check_backup.sh"}, None, None),
    ]),
    "linux_docker": ("server", [
        ("ping", "ping", {}, None, None),
        ("ssh_port", "port", {"port": 22}, None, None),
        ("cpu_usage", "ssh_cpu", {}, 80, 95),
        ("ram_usage", "ssh_mem", {}, 85, 95),
        ("disk_root", "ssh_disk", {"mount": "/"}, 85, 95),
        ("disk_docker", "ssh_disk", {"mount": "/var/lib/docker"}, 85, 95),
        ("docker_process", "ssh_process", {"process": "dockerd"}, None, None),
        ("container_count", "script", {"command": "docker ps -q | wc -l"}, None, None),
        ("load_avg", "ssh_cpu", {}, None, None),
    ]),

    # ── Storage / NAS ──────────────────────────────────────────────────────────
    "synology": ("server", [
        ("ping", "ping", {}, None, None),
        ("dsm_http", "http", {"url": "https://localhost:5001"}, None, None),
        ("cpu_usage", "snmp", {"oid": "1.3.6.1.4.1.6574.1.2.0"}, 80, 95),
        ("ram_usage", "snmp", {"oid": "1.3.6.1.4.1.6574.1.3.0"}, 85, 95),
        ("disk_volume1", "snmp", {"oid": "1.3.6.1.4.1.6574.2.1.1.5.0"}, 80, 90),
        ("raid_status", "snmp", {"oid": "1.3.6.1.4.1.6574.3.1.1.3.0"}, None, None),
        ("temperature", "snmp", {"oid": "1.3.6.1.4.1.6574.1.1.0"}, 45, 55),
        ("ups_status", "snmp", {}, None, None),
    ]),
    "qnap": ("server", [
        ("ping", "ping", {}, None, None),
        ("qts_http", "http", {"url": "https://localhost:8080"}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("disk_pool1", "snmp", {}, 80, 90),
        ("raid_status", "snmp", {}, None, None),
        ("temperature", "snmp", {}, 45, 55),
    ]),
    "netapp": ("server", [
        ("ping", "ping", {}, None, None),
        ("ontap_http", "http", {"url": "https://localhost/api/cluster"}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("aggregate_root", "snmp", {}, 80, 90),
        ("aggregate_data", "snmp", {}, 80, 90),
        ("volume_count", "snmp", {}, None, None),
        ("disk_health", "snmp", {}, None, None),
        ("snapmirror_lag", "snmp", {}, None, None),
        ("cluster_health", "snmp", {}, None, None),
        ("throughput", "snmp", {}, None, None),
        ("latency", "snmp", {}, None, None),
        ("iops", "snmp", {}, None, None),
    ]),

    # ── Printers ───────────────────────────────────────────────────────────────
    "printer_bw": ("printer", [
        ("ping", "ping", {}, None, None),
        ("toner_black", "snmp", {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.1"}, 15, 5),
        ("page_count", "snmp", {"oid": "1.3.6.1.2.1.43.10.2.1.4.1.1"}, None, None),
        ("paper_tray_1", "snmp", {}, None, None),
    ]),
    "printer_color": ("printer", [
        ("ping", "ping", {}, None, None),
        ("toner_black", "snmp", {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.1"}, 15, 5),
        ("toner_cyan", "snmp", {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.2"}, 15, 5),
        ("toner_magenta", "snmp", {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.3"}, 15, 5),
        ("toner_yellow", "snmp", {"oid": "1.3.6.1.2.1.43.11.1.1.9.1.4"}, 15, 5),
        ("page_count", "snmp", {}, None, None),
        ("paper_tray_1", "snmp", {}, None, None),
    ]),

    # ── UPS ────────────────────────────────────────────────────────────────────
    "ups_basic": ("other", [
        ("ping", "ping", {}, None, None),
        ("battery_status", "snmp", {"oid": "1.3.6.1.2.1.33.1.2.1.0"}, None, None),
        ("battery_capacity", "snmp", {"oid": "1.3.6.1.2.1.33.1.2.4.0"}, 50, 20),
        ("input_voltage", "snmp", {"oid": "1.3.6.1.2.1.33.1.3.3.1.3.1"}, None, None),
        ("output_load", "snmp", {"oid": "1.3.6.1.2.1.33.1.4.4.1.5.1"}, 80, 95),
        ("runtime_remaining", "snmp", {}, None, None),
    ]),
    "ups_advanced": ("other", [
        ("ping", "ping", {}, None, None),
        ("battery_status", "snmp", {}, None, None),
        ("battery_capacity", "snmp", {}, 50, 20),
        ("input_voltage", "snmp", {}, None, None),
        ("output_load", "snmp", {}, 80, 95),
        ("runtime_remaining", "snmp", {}, None, None),
        ("temperature", "snmp", {}, 30, 40),
        ("humidity", "snmp", {}, 70, 85),
    ]),

    # ── IP Cameras ─────────────────────────────────────────────────────────────
    "ip_camera": ("other", [
        ("ping", "ping", {}, None, None),
        ("rtsp_stream", "port", {"port": 554}, None, None),
        ("http_mgmt", "http", {"url": "http://localhost"}, None, None),
    ]),

    # ── Virtualization ─────────────────────────────────────────────────────────
    "vmware_esxi": ("server", [
        ("ping", "ping", {}, None, None),
        ("https_mgmt", "port", {"port": 443}, None, None),
        ("cpu_usage", "snmp", {}, 80, 95),
        ("ram_usage", "snmp", {}, 85, 95),
        ("datastore_local", "snmp", {}, 80, 90),
        ("datastore_san", "snmp", {}, 80, 90),
        ("vm_count", "snmp", {}, None, None),
        ("hardware_health", "snmp", {}, None, None),
    ]),
}

# ═══════════════════════════════════════════════════════════════════════════════
# Hostname prefixes & display name templates
# ═══════════════════════════════════════════════════════════════════════════════

PREFIXES = {
    "fortinet_small": "fw-forti", "fortinet_ha": "fw-forti", "sonicwall": "fw-sonic",
    "cisco_switch": "sw-cisco", "hp_switch": "sw-hp", "aruba_switch": "sw-aruba",
    "aruba_ap": "ap",
    "windows_dc": "srv-dc", "windows_file": "srv-file", "windows_app": "srv-app",
    "windows_exchange": "srv-exchange", "windows_sql": "srv-sql", "windows_rdsh": "srv-rdsh",
    "linux_basic": "srv-linux", "linux_web": "srv-web", "linux_db": "srv-db",
    "linux_docker": "srv-docker",
    "synology": "nas-synology", "qnap": "nas-qnap", "netapp": "san-netapp",
    "printer_bw": "prt", "printer_color": "prt-color",
    "ups_basic": "ups", "ups_advanced": "ups",
    "ip_camera": "cam", "vmware_esxi": "esxi",
}

DISPLAYS = {
    "fortinet_small": "FortiGate {n}", "fortinet_ha": "FortiGate HA {n}",
    "sonicwall": "SonicWall {n}",
    "cisco_switch": "Cisco Catalyst {n}", "hp_switch": "HP ProCurve {n}",
    "aruba_switch": "Aruba CX {n}",
    "aruba_ap": "Aruba AP {n}",
    "windows_dc": "Domain Controller {n}", "windows_file": "Fileserver {n}",
    "windows_app": "Applikationsserver {n}", "windows_exchange": "Exchange Server {n}",
    "windows_sql": "SQL Server {n}", "windows_rdsh": "Terminalserver {n}",
    "linux_basic": "Linux Server {n}", "linux_web": "Webserver {n}",
    "linux_db": "Datenbankserver {n}", "linux_docker": "Docker Host {n}",
    "synology": "Synology DS {n}", "qnap": "QNAP TS {n}", "netapp": "NetApp FAS {n}",
    "printer_bw": "Drucker S/W {n}", "printer_color": "Drucker Farbe {n}",
    "ups_basic": "USV {n}", "ups_advanced": "USV {n}",
    "ip_camera": "IP-Kamera {n}", "vmware_esxi": "ESXi Host {n}",
}

# ═══════════════════════════════════════════════════════════════════════════════
# Infrastructure Profiles – {device_template: count}
# ═══════════════════════════════════════════════════════════════════════════════

PROFILES = {
    "tiny_office": {
        "fortinet_small": 1, "aruba_switch": 1, "windows_app": 1,
        "synology": 1, "printer_bw": 1,
    },
    "small_office": {
        "fortinet_small": 1, "aruba_switch": 2, "windows_dc": 1,
        "windows_file": 1, "synology": 1, "printer_color": 1,
        "ups_basic": 1, "aruba_ap": 2,
    },
    "medium_business": {
        "fortinet_small": 1, "cisco_switch": 3, "hp_switch": 1,
        "windows_dc": 1, "windows_file": 1, "windows_app": 2,
        "linux_web": 1, "linux_db": 1, "synology": 1,
        "printer_color": 2, "printer_bw": 1, "ups_basic": 1,
        "aruba_ap": 4, "ip_camera": 2,
    },
    "large_business": {
        "fortinet_ha": 1, "sonicwall": 1, "cisco_switch": 5, "hp_switch": 2,
        "windows_dc": 1, "windows_exchange": 1, "windows_file": 2,
        "windows_app": 2, "windows_sql": 1, "linux_web": 1, "linux_db": 2,
        "linux_docker": 1, "synology": 1, "qnap": 1,
        "printer_color": 2, "printer_bw": 2, "ups_basic": 2,
        "vmware_esxi": 1, "aruba_ap": 6, "ip_camera": 4,
    },
    "enterprise": {
        "fortinet_ha": 2, "cisco_switch": 10, "hp_switch": 4, "aruba_switch": 2,
        "windows_dc": 2, "windows_exchange": 1, "windows_file": 2,
        "windows_app": 4, "windows_sql": 2, "windows_rdsh": 3,
        "linux_web": 4, "linux_db": 3, "linux_docker": 3,
        "netapp": 2, "synology": 2, "printer_color": 4, "printer_bw": 4,
        "ups_advanced": 3, "vmware_esxi": 4, "aruba_ap": 15, "ip_camera": 6,
    },
    "campus": {
        "fortinet_ha": 2, "cisco_switch": 16, "aruba_switch": 8, "hp_switch": 4,
        "windows_dc": 3, "windows_exchange": 2, "windows_file": 3,
        "windows_app": 6, "windows_sql": 3, "windows_rdsh": 4,
        "linux_web": 6, "linux_db": 4, "linux_docker": 5,
        "netapp": 3, "synology": 2, "qnap": 1,
        "printer_color": 8, "printer_bw": 10, "ups_advanced": 4,
        "vmware_esxi": 5, "aruba_ap": 25, "ip_camera": 8,
    },
    "datacenter": {
        "fortinet_ha": 2, "cisco_switch": 12, "aruba_switch": 4,
        "windows_dc": 2, "windows_app": 4, "linux_web": 8,
        "linux_db": 6, "linux_docker": 10, "netapp": 4,
        "ups_advanced": 6, "vmware_esxi": 8, "ip_camera": 4,
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# Tenant Definitions – (name, slug, profile)
# ═══════════════════════════════════════════════════════════════════════════════

TENANTS = [
    # Tiny offices
    ("Zahnarztpraxis Dr. Weber", "zahnarzt-weber", "tiny_office"),
    ("Architekturbüro Neumann", "architektur-neumann", "tiny_office"),
    ("Steuerberater Hoffmann", "stb-hoffmann", "tiny_office"),
    ("Physiotherapie Sonnenschein", "physio-sonnenschein", "tiny_office"),
    # Small offices
    ("Anwaltskanzlei Richter & Partner", "kanzlei-richter", "small_office"),
    ("Immobilien Krause", "immobilien-krause", "small_office"),
    ("Werbeagentur Creativ", "agentur-creativ", "small_office"),
    ("Ingenieurbüro Maier", "ing-maier", "small_office"),
    # Medium businesses
    ("Autohaus Becker", "autohaus-becker", "medium_business"),
    ("Hotel Seeblick", "hotel-seeblick", "medium_business"),
    ("Logistik Express GmbH", "logistik-express", "medium_business"),
    ("Modehaus Fischer", "modehaus-fischer", "medium_business"),
    # Large businesses
    ("Baumarkt König", "baumarkt-koenig", "large_business"),
    ("Spedition Hartmann", "spedition-hartmann", "large_business"),
    ("Stadtwerke Neustadt", "stadtwerke-neustadt", "large_business"),
    ("Brauerei Goldener Hirsch", "brauerei-hirsch", "large_business"),
    # Enterprise
    ("Klinik am Park", "klinik-am-park", "enterprise"),
    ("Versicherung Nordwest", "versicherung-nw", "enterprise"),
    ("Industriewerk Schwarz AG", "industriewerk-schwarz", "enterprise"),
    ("Medienhaus Digital GmbH", "medienhaus-digital", "enterprise"),
    ("Finanzdienstleister Berger", "finanz-berger", "enterprise"),
    # Campus
    ("Universität Musterstadt", "uni-musterstadt", "campus"),
    ("Konzern Müller Holding", "mueller-holding", "campus"),
    # Additional enterprise
    ("Pharmaunternehmen Vetter", "pharma-vetter", "enterprise"),
    ("Energieversorger Rheinland", "energie-rheinland", "enterprise"),
    ("Kanzlei Großmann & Söhne", "kanzlei-grossmann", "enterprise"),
    ("Lebensmittelkonzern Frisch AG", "frisch-ag", "enterprise"),
    # Additional campus
    ("Technische Hochschule Bergheim", "th-bergheim", "campus"),
    ("Landratsamt Oberberg", "landratsamt-oberberg", "campus"),
    # Additional large
    ("Maschinenbau Krüger", "maschinenbau-krueger", "large_business"),
    ("Textilwerk Hoffmann", "textilwerk-hoffmann", "large_business"),
    ("Elektro Schulz GmbH", "elektro-schulz", "large_business"),
    # Additional medium
    ("Bäckerei Goldkruste", "baeckerei-goldkruste", "medium_business"),
    ("Reisebüro Fernweh", "reisebuero-fernweh", "medium_business"),
    # Additional campus
    ("Forschungszentrum Jülich", "fz-juelich", "campus"),
    # Additional enterprise
    ("Wohnungsbau Rhein-Main", "wohnungsbau-rm", "enterprise"),
    ("Chemiewerk Ludwigshafen", "chemiewerk-lu", "enterprise"),
    # Additional large
    ("Getränkehandel Weber", "getraenke-weber", "large_business"),
    ("Druckerei Schneider", "druckerei-schneider", "large_business"),
    # Datacenter
    ("Rechenzentrum Süd GmbH", "rz-sued", "datacenter"),
    ("Cloud Hosting Nord", "cloud-nord", "datacenter"),
]


# ═══════════════════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════════════════

def generate_api_key(slug: str) -> tuple[str, str, str]:
    """Return (full_key, sha256_hash, prefix_12)."""
    secret = secrets.token_urlsafe(32)
    full_key = f"overseer_{slug}_{secret}"
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, key_hash, full_key[:12]


def generate_hosts(profile_name: str, subnet_idx: int):
    """
    Yield (hostname, display_name, ip, host_type, device_template, checks)
    for every host in the given profile.
    """
    profile = PROFILES[profile_name]
    ip_counter = 1
    # Sort for deterministic output
    for dev_type in sorted(profile.keys()):
        count = profile[dev_type]
        host_type, checks = DEVICES[dev_type]
        prefix = PREFIXES[dev_type]
        display_tpl = DISPLAYS[dev_type]
        for i in range(1, count + 1):
            num = f"{i:02d}"
            hostname = f"{prefix}-{num}"
            display = display_tpl.format(n=num)
            # IP: 10.{subnet_idx}.{octet3}.{octet4}
            octet3 = ip_counter // 254
            octet4 = (ip_counter % 254) + 1
            ip = f"10.{subnet_idx}.{octet3}.{octet4}"
            ip_counter += 1
            yield hostname, display, ip, host_type, dev_type, checks


def pick_status(dev_type: str, check_name: str) -> tuple[str, str, float | None, str | None, int]:
    """
    Return (status, state_type, value, unit, current_attempt) for initial seeding.
    ALL OK – any non-OK in the dashboard means the system has a real problem.
    """
    name = check_name.lower()
    if name == "ping":
        return "OK", "HARD", 1.5, "ms", 1
    if "cpu" in name or "load" in name:
        return "OK", "HARD", 22.0, "%", 1
    if "ram" in name or "swap" in name:
        return "OK", "HARD", 41.0, "%", 1
    if any(x in name for x in ("disk", "volume", "aggregate", "datastore", "pool")):
        return "OK", "HARD", 48.0, "%", 1
    if "toner" in name:
        return "OK", "HARD", 72.0, "%", 1
    if "temperature" in name or "humidity" in name:
        return "OK", "HARD", 34.0, "°C", 1
    if any(x in name for x in ("port", "http", "https", "smb", "rdp", "ssh",
                                 "smtp", "mysql", "mssql", "dns", "rtsp")):
        return "OK", "HARD", 1.8, "ms", 1
    return "OK", "HARD", 1.0, "", 1


STATUS_MESSAGES = {
    "ping": {
        "OK": "PING OK - rta={val:.2f}ms, packet loss=0%",
        "WARNING": "PING WARNING - rta={val:.1f}ms, packet loss=5%",
        "CRITICAL": "PING CRITICAL - Host unreachable (100% packet loss)",
    },
    "cpu": {
        "OK": "CPU OK - usage={val:.1f}%",
        "WARNING": "CPU WARNING - usage={val:.1f}%",
        "CRITICAL": "CPU CRITICAL - usage={val:.1f}%",
    },
    "disk": {
        "OK": "DISK OK - {val:.1f}% used",
        "WARNING": "DISK WARNING - {val:.1f}% used",
        "CRITICAL": "DISK CRITICAL - {val:.1f}% used, freien Speicher prüfen!",
    },
    "ram": {
        "OK": "RAM OK - usage={val:.1f}%",
        "WARNING": "RAM WARNING - usage={val:.1f}%",
        "CRITICAL": "RAM CRITICAL - usage={val:.1f}%",
    },
    "toner": {
        "OK": "Toner OK - {val:.0f}% verbleibend",
        "WARNING": "Toner WARNING - nur noch {val:.0f}%",
        "CRITICAL": "Toner CRITICAL - nur noch {val:.0f}%! Austausch nötig",
    },
    "port": {
        "OK": "Port OK - open, response={val:.2f}ms",
        "CRITICAL": "Port CRITICAL - connection refused",
    },
    "backup": {
        "OK": "Backup OK - letztes Backup erfolgreich",
        "WARNING": "Backup WARNING - letztes Backup > 24h her",
        "CRITICAL": "Backup CRITICAL - fehlgeschlagen!",
    },
    "default": {
        "OK": "Check OK",
        "WARNING": "Check WARNING - Schwellwert überschritten",
        "CRITICAL": "Check CRITICAL",
        "UNKNOWN": "Check konnte nicht ausgeführt werden",
    },
}


def get_status_message(check_name: str, status: str, value: float | None) -> str:
    val = value or 0.0
    # Find matching message template
    for key in ("ping", "cpu", "disk", "ram", "toner", "port", "backup"):
        if key in check_name:
            templates = STATUS_MESSAGES[key]
            tpl = templates.get(status, STATUS_MESSAGES["default"].get(status, ""))
            return tpl.format(val=val)
    tpl = STATUS_MESSAGES["default"].get(status, "")
    return tpl.format(val=val)


# ═══════════════════════════════════════════════════════════════════════════════
# Main Seeding Logic
# ═══════════════════════════════════════════════════════════════════════════════

def seed(db_url: str, clean: bool = False):
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    if clean:
        print("Cleaning existing data...")
        for tbl in ("check_results", "state_history", "current_status",
                     "downtimes", "services", "hosts", "api_keys",
                     "collectors", "audit_log", "notification_channels",
                     "user_tenant_access", "users", "tenants"):
            cur.execute(f"DELETE FROM {tbl}")
        conn.commit()
        print("  Done.\n")

    # Password hash for demo users (admin123)
    pw_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode()

    # Super admin
    cur.execute(
        """INSERT INTO users (tenant_id, email, password_hash, display_name, role)
           VALUES (NULL, 'admin@overseer.local', %s, 'Super Admin', 'super_admin')
           ON CONFLICT (email) DO NOTHING""",
        (pw_hash,),
    )

    now = datetime.now(timezone.utc)
    config_out = {}  # For demo_collector_large.py config
    total_hosts = 0
    total_checks = 0

    for idx, (tenant_name, slug, profile_name) in enumerate(TENANTS, start=1):
        print(f"[{idx:2d}/{len(TENANTS)}] {tenant_name} ({profile_name})...")

        # ── Tenant ──
        tid = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO tenants (id, name, slug) VALUES (%s, %s, %s) "
            "ON CONFLICT (slug) DO NOTHING",
            (tid, tenant_name, slug),
        )
        cur.execute("SELECT id FROM tenants WHERE slug = %s", (slug,))
        tid = str(cur.fetchone()[0])

        # ── Tenant admin user ──
        cur.execute(
            """INSERT INTO users (tenant_id, email, password_hash, display_name, role)
               VALUES (%s, %s, %s, %s, 'tenant_admin')
               ON CONFLICT (email) DO NOTHING""",
            (tid, f"admin@{slug}.local", pw_hash, f"Admin {tenant_name}"),
        )

        # ── Collector ──
        cid = str(uuid.uuid4())
        cur.execute(
            "SELECT id FROM collectors WHERE tenant_id = %s AND name = %s",
            (tid, f"collector-{slug}"),
        )
        row = cur.fetchone()
        if row:
            cid = str(row[0])
        else:
            cur.execute(
                """INSERT INTO collectors (id, tenant_id, name, hostname, ip_address, last_seen_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (cid, tid, f"collector-{slug}", f"collector-{slug}.local",
                 f"10.{idx}.0.250", now),
            )

        # ── API Key ──
        cur.execute(
            "SELECT key_prefix FROM api_keys WHERE tenant_id = %s AND name = %s",
            (tid, f"Collector Key {slug}"),
        )
        existing = cur.fetchone()
        if existing:
            full_key = f"{existing[0]}…(existing)"
        else:
            full_key, key_hash, key_prefix = generate_api_key(slug)
            cur.execute(
                """INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name)
                   VALUES (%s, %s, %s, %s)""",
                (tid, key_hash, key_prefix, f"Collector Key {slug}"),
            )

        # ── Hosts & Services ──
        tenant_services = []
        host_count = 0
        check_count = 0

        for hostname, display, ip, host_type, dev_type, checks in generate_hosts(profile_name, idx):
            hid = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO hosts (id, tenant_id, collector_id, hostname, display_name,
                   ip_address, host_type)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (tenant_id, hostname) DO NOTHING""",
                (hid, tid, cid, hostname, display, ip, host_type),
            )
            cur.execute(
                "SELECT id FROM hosts WHERE tenant_id = %s AND hostname = %s",
                (tid, hostname),
            )
            hid = str(cur.fetchone()[0])
            host_count += 1

            for check_name, check_type, check_config, warn, crit in checks:
                sid = str(uuid.uuid4())
                cur.execute(
                    """INSERT INTO services (id, host_id, tenant_id, name, check_type,
                       check_config, threshold_warn, threshold_crit, max_check_attempts)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 3)
                       ON CONFLICT (host_id, name) DO NOTHING""",
                    (sid, hid, tid, check_name, check_type,
                     json.dumps(check_config), warn, crit),
                )
                cur.execute(
                    "SELECT id FROM services WHERE host_id = %s AND name = %s",
                    (hid, check_name),
                )
                sid = str(cur.fetchone()[0])

                # ── Current Status ──
                status, state_type, value, unit, attempt = pick_status(dev_type, check_name)
                msg = get_status_message(check_name, status, value)
                state_change = now - timedelta(
                    minutes=random.randint(10, 4320) if status != "OK"
                    else random.randint(60, 43200)
                )

                cur.execute(
                    """INSERT INTO current_status
                       (service_id, host_id, tenant_id, status, state_type,
                        current_attempt, status_message, value, unit,
                        last_check_at, last_state_change_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (service_id) DO NOTHING""",
                    (sid, hid, tid, status, state_type, attempt,
                     msg, value, unit, now, state_change),
                )

                tenant_services.append({
                    "host": hostname,
                    "name": check_name,
                    "check_type": check_type,
                    "config": check_config,
                })
                check_count += 1

        total_hosts += host_count
        total_checks += check_count
        print(f"       {host_count} hosts, {check_count} checks")

        config_out[slug] = {
            "tenant_id": tid,
            "collector_id": cid,
            "api_key": full_key,
            "services": tenant_services,
        }

    conn.commit()
    cur.close()
    conn.close()

    # Save config for demo collector
    config_path = os.path.join(os.path.dirname(__file__), "large_demo_config.json")
    with open(config_path, "w") as f:
        json.dump(config_out, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Seeding complete!")
    print(f"  Tenants:  {len(TENANTS)}")
    print(f"  Hosts:    {total_hosts}")
    print(f"  Checks:   {total_checks}")
    print(f"  Config:   {config_path}")
    print(f"\nSuper Admin: admin@overseer.local / admin123")
    print(f"{'='*60}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Overseer Large-Scale Demo Seeder")
    parser.add_argument("--db-url", default=DB_URL, help="PostgreSQL connection URL (sync)")
    parser.add_argument("--clean", action="store_true", help="Delete all existing data first")
    args = parser.parse_args()
    seed(args.db_url, args.clean)
