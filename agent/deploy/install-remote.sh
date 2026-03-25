#!/bin/bash
set -euo pipefail

# ── Overseer Agent — Remote Installer ──────────────────────────────────────
# Usage:  curl -fsSL https://overseer.example.com/agent/install.sh | sudo bash -s -- TOKEN
# Re-run safe: updates binary, preserves or overwrites config, restarts service.

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
error() { echo -e "${RED}[ERR]${NC}   $*"; exit 1; }
step()  { echo -e "${CYAN}[...]${NC}  $*"; }

# ── Checks ─────────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    error "Dieses Script muss als root ausgeführt werden (sudo)"
fi

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
    echo ""
    echo "Overseer Agent Installer"
    echo "────────────────────────"
    echo ""
    echo "Usage:  curl -fsSL SERVER_URL/agent/install.sh | sudo bash -s -- TOKEN"
    echo ""
    echo "  TOKEN  =  Agent-Token aus der Overseer-Oberfläche"
    echo ""
    error "Kein Token angegeben"
fi

# Detect server URL from where this script was downloaded (passed as $2 or auto-detect)
SERVER_URL="${2:-}"
if [ -z "$SERVER_URL" ]; then
    # If piped from curl, we don't know the URL — check existing config first
    if [ -f "${CONFIG_DIR}/config.yaml" ]; then
        SERVER_URL=$(grep -oP '^\s*server:\s*"\K[^"]+' "${CONFIG_DIR}/config.yaml" 2>/dev/null || \
                     grep -oP '^\s*server:\s*\K\S+' "${CONFIG_DIR}/config.yaml" 2>/dev/null || true)
    fi
    if [ -z "$SERVER_URL" ]; then
        error "Server-URL konnte nicht ermittelt werden. Bitte als zweites Argument angeben:\n       curl ... | sudo bash -s -- TOKEN https://overseer.example.com"
    fi
fi

# Strip trailing slash
SERVER_URL="${SERVER_URL%/}"

echo ""
echo -e "  ${CYAN}Overseer Agent Installer${NC}"
echo "  ──────────────────────"
echo -e "  Server:  ${SERVER_URL}"
echo -e "  Token:   ${TOKEN:0:20}..."
echo ""

# ── Stop existing agent if running ─────────────────────────────────────────

if systemctl is-active --quiet overseer-agent 2>/dev/null; then
    step "Bestehenden Agent stoppen..."
    systemctl stop overseer-agent
    info "Agent gestoppt"
fi

# ── Download binary ────────────────────────────────────────────────────────

step "Binary herunterladen..."
TMP_BIN=$(mktemp)
HTTP_CODE=$(curl -fsSL -o "$TMP_BIN" -w "%{http_code}" "${SERVER_URL}/agent/${DOWNLOAD_NAME}" 2>/dev/null || true)

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMP_BIN" ]; then
    rm -f "$TMP_BIN"
    error "Download fehlgeschlagen (HTTP ${HTTP_CODE}). Ist die URL korrekt? ${SERVER_URL}/agent/${DOWNLOAD_NAME}"
fi

# Verify it's actually an ELF binary
if ! file "$TMP_BIN" 2>/dev/null | grep -q "ELF"; then
    rm -f "$TMP_BIN"
    error "Heruntergeladene Datei ist kein gültiges Linux-Binary"
fi

install -m 0755 "$TMP_BIN" "${INSTALL_DIR}/${BINARY_NAME}"
rm -f "$TMP_BIN"
info "Binary installiert: ${INSTALL_DIR}/${BINARY_NAME}"

# ── Config ─────────────────────────────────────────────────────────────────

mkdir -p "${CONFIG_DIR}"
mkdir -p "${LOG_DIR}"

if [ -f "${CONFIG_DIR}/config.yaml" ]; then
    step "Config existiert — wird mit neuem Token aktualisiert..."
fi

cat > "${CONFIG_DIR}/config.yaml" <<CONF
server: "${SERVER_URL}"
token: "${TOKEN}"
log_level: "info"
CONF
chmod 600 "${CONFIG_DIR}/config.yaml"
info "Config geschrieben: ${CONFIG_DIR}/config.yaml"

# ── systemd Service ────────────────────────────────────────────────────────

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

# ── Start ──────────────────────────────────────────────────────────────────

step "Agent starten..."
systemctl enable --quiet overseer-agent
systemctl start overseer-agent

# Brief wait and check
sleep 2
if systemctl is-active --quiet overseer-agent; then
    info "Agent läuft!"
else
    warn "Agent wurde gestartet, scheint aber nicht zu laufen."
    echo ""
    echo "  Logs prüfen:  sudo journalctl -u overseer-agent --no-pager -n 20"
    echo ""
    exit 1
fi

echo ""
echo -e "  ${GREEN}Installation erfolgreich!${NC}"
echo ""
echo "  Status:   sudo systemctl status overseer-agent"
echo "  Logs:     sudo journalctl -u overseer-agent -f"
echo "  Neustart: sudo systemctl restart overseer-agent"
echo ""
