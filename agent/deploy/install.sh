#!/bin/bash
set -euo pipefail

# Overseer Agent Installer for Linux (amd64)

BINARY_NAME="overseer-agent"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/overseer-agent"
LOG_DIR="/var/log/overseer-agent"
SERVICE_FILE="/etc/systemd/system/overseer-agent.service"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# Check root
if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root (sudo)"
fi

# Check binary exists
if [ ! -f "${SCRIPT_DIR}/${BINARY_NAME}" ]; then
    error "Binary '${BINARY_NAME}' not found in ${SCRIPT_DIR}"
fi

info "Installing Overseer Agent..."

# 1. Copy binary
install -m 0755 "${SCRIPT_DIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
info "Binary installed to ${INSTALL_DIR}/${BINARY_NAME}"

# 2. Create config directory
mkdir -p "${CONFIG_DIR}"

# 3. Create config file if it doesn't exist
if [ ! -f "${CONFIG_DIR}/config.yaml" ]; then
    cat > "${CONFIG_DIR}/config.yaml" <<'EOF'
# Overseer Agent Configuration
# server: URL of the Overseer server (required)
server: "https://your-overseer-server.example.com"

# token: Agent token from the Overseer UI (required)
token: "overseer_agent_YOUR_TOKEN_HERE"

# log_level: debug, info, warn, error (default: info)
log_level: "info"

# log_file: Path to log file (optional, logs to stdout/journal if empty)
# log_file: "/var/log/overseer-agent/agent.log"
EOF
    warn "Config created at ${CONFIG_DIR}/config.yaml — edit it with your server URL and token!"
else
    info "Config already exists at ${CONFIG_DIR}/config.yaml (not overwritten)"
fi

chmod 600 "${CONFIG_DIR}/config.yaml"

# 4. Create log directory
mkdir -p "${LOG_DIR}"

# 5. Install systemd service
if [ -f "${SCRIPT_DIR}/overseer-agent.service" ]; then
    cp "${SCRIPT_DIR}/overseer-agent.service" "${SERVICE_FILE}"
else
    # Fallback: create inline
    cat > "${SERVICE_FILE}" <<'EOF'
[Unit]
Description=Overseer Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/overseer-agent --config /etc/overseer-agent/config.yaml
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/overseer-agent
PrivateTmp=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-agent

[Install]
WantedBy=multi-user.target
EOF
fi

info "Systemd service installed"

# 6. Reload systemd and enable
systemctl daemon-reload
systemctl enable overseer-agent
info "Service enabled (will start on boot)"

echo ""
info "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit the config:    sudo nano ${CONFIG_DIR}/config.yaml"
echo "  2. Set your server URL and agent token"
echo "  3. Start the agent:    sudo systemctl start overseer-agent"
echo "  4. Check status:       sudo systemctl status overseer-agent"
echo "  5. View logs:          sudo journalctl -u overseer-agent -f"
