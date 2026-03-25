#!/bin/bash
set -euo pipefail

# ── Overseer Agent — Remote Installer ──────────────────────────────────────
# Works on Debian, Ubuntu, RHEL, Rocky, AlmaLinux, SUSE, Arch, etc.
# Uses wget or curl (whichever is available).
# Re-run safe: updates binary, overwrites config, restarts service.
#
# Usage:
#   wget -qO- URL/agent/install.sh | bash -s -- TOKEN SERVER_URL
#   curl -fsSL URL/agent/install.sh | bash -s -- TOKEN SERVER_URL

BINARY_NAME="overseer-agent"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/overseer-agent"
LOG_DIR="/var/log/overseer-agent"
SERVICE_FILE="/etc/systemd/system/overseer-agent.service"
DOWNLOAD_NAME="overseer-agent-linux-amd64"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[ERR]${NC}   $*"; exit 1; }
step()  { echo -e "${CYAN}[...]${NC}  $*"; }

# ── Root check ─────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    fail "Dieses Script muss als root ausgeführt werden.\n       Tipp: su -c 'bash -s -- TOKEN URL' oder sudo bash -s -- TOKEN URL"
fi

# ── Arguments ──────────────────────────────────────────────────────────────

TOKEN="${1:-}"
SERVER_URL="${2:-}"

if [ -z "$TOKEN" ] || [ -z "$SERVER_URL" ]; then
    echo ""
    echo "  Overseer Agent Installer"
    echo "  ────────────────────────"
    echo ""
    echo "  Usage:  wget -qO- SERVER/agent/install.sh | bash -s -- TOKEN SERVER"
    echo "          curl -fsSL SERVER/agent/install.sh | bash -s -- TOKEN SERVER"
    echo ""
    echo "  TOKEN  = Agent-Token aus der Overseer-Oberfläche"
    echo "  SERVER = URL des Overseer-Servers (z.B. https://overseer.example.com)"
    echo ""
    fail "Token und Server-URL sind erforderlich"
fi

SERVER_URL="${SERVER_URL%/}"

# ── Pick download tool ─────────────────────────────────────────────────────

download() {
    local url="$1" dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$dest" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$url"
    else
        fail "Weder curl noch wget gefunden.\n       Installiere eins davon:\n         Debian/Ubuntu:  apt install -y wget\n         RHEL/Rocky:     dnf install -y wget\n         SUSE:           zypper install -y wget"
    fi
}

echo ""
echo -e "  ${CYAN}Overseer Agent Installer${NC}"
echo "  ──────────────────────"
echo -e "  Server:  ${SERVER_URL}"
echo -e "  Token:   ${TOKEN:0:20}..."
echo ""

# ── Stop existing agent ───────────────────────────────────────────────────

if systemctl is-active --quiet overseer-agent 2>/dev/null; then
    step "Bestehenden Agent stoppen..."
    systemctl stop overseer-agent
    info "Agent gestoppt"
fi

# ── Download binary ───────────────────────────────────────────────────────

step "Binary herunterladen..."
TMP_BIN=$(mktemp)
if ! download "${SERVER_URL}/agent/${DOWNLOAD_NAME}" "$TMP_BIN"; then
    rm -f "$TMP_BIN"
    fail "Download fehlgeschlagen. URL erreichbar? ${SERVER_URL}/agent/${DOWNLOAD_NAME}"
fi

if [ ! -s "$TMP_BIN" ]; then
    rm -f "$TMP_BIN"
    fail "Download ist leer"
fi

install -m 0755 "$TMP_BIN" "${INSTALL_DIR}/${BINARY_NAME}"
rm -f "$TMP_BIN"
info "Binary installiert: ${INSTALL_DIR}/${BINARY_NAME}"

# Version check
if "${INSTALL_DIR}/${BINARY_NAME}" --version >/dev/null 2>&1; then
    VER=$("${INSTALL_DIR}/${BINARY_NAME}" --version 2>&1 || true)
    info "Version: ${VER}"
fi

# ── Config ────────────────────────────────────────────────────────────────

mkdir -p "${CONFIG_DIR}"
mkdir -p "${LOG_DIR}"

if [ -f "${CONFIG_DIR}/config.yaml" ]; then
    step "Config wird aktualisiert..."
fi

cat > "${CONFIG_DIR}/config.yaml" <<CONF
server: "${SERVER_URL}"
token: "${TOKEN}"
log_level: "info"
CONF
chmod 600 "${CONFIG_DIR}/config.yaml"
info "Config: ${CONFIG_DIR}/config.yaml"

# ── systemd Service ──────────────────────────────────────────────────────

step "systemd-Service einrichten..."
cat > "${SERVICE_FILE}" <<'SERVICE'
[Unit]
Description=Overseer Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/overseer-agent --config /etc/overseer-agent/config.yaml
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
NoNewPrivileges=true
ProtectHome=true
ReadWritePaths=/var/log/overseer-agent
PrivateTmp=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-agent

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
info "Service-Unit installiert"

# ── Start ─────────────────────────────────────────────────────────────────

step "Agent starten..."
systemctl enable --quiet overseer-agent
systemctl start overseer-agent

sleep 2
if systemctl is-active --quiet overseer-agent; then
    info "Agent läuft!"
else
    warn "Agent gestartet, scheint aber nicht zu laufen."
    echo ""
    echo "  Logs prüfen:  journalctl -u overseer-agent --no-pager -n 20"
    echo ""
    exit 1
fi

echo ""
echo -e "  ${GREEN}Installation erfolgreich!${NC}"
echo ""
echo "  Status:    systemctl status overseer-agent"
echo "  Logs:      journalctl -u overseer-agent -f"
echo "  Neustart:  systemctl restart overseer-agent"
echo ""
