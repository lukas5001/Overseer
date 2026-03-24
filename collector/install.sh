#!/usr/bin/env bash
#
# Overseer Collector – Install Script
#
# Usage:
#   curl -sSL https://overseer.example.com/install.sh | bash -s -- \
#     --api-url https://overseer.example.com \
#     --receiver-url https://overseer.example.com \
#     --api-key overseer_XXXXXXXXXX \
#     --collector-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# What this script does:
#   1. Downloads the overseer-collector binary to /usr/local/bin/
#   2. Creates /etc/overseer/collector.env with credentials
#   3. Creates a systemd service (overseer-collector.service)
#   4. Enables and starts the service
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/overseer"
SERVICE_USER="overseer"
BINARY_NAME="overseer-collector"

API_URL=""
RECEIVER_URL=""
API_KEY=""
COLLECTOR_ID=""

# ── Parse args ────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)      API_URL="$2"; shift 2 ;;
    --receiver-url) RECEIVER_URL="$2"; shift 2 ;;
    --api-key)      API_KEY="$2"; shift 2 ;;
    --collector-id) COLLECTOR_ID="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: install.sh --api-url URL --receiver-url URL --api-key KEY --collector-id UUID"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────

if [[ -z "$API_URL" || -z "$RECEIVER_URL" || -z "$API_KEY" || -z "$COLLECTOR_ID" ]]; then
  echo "Error: All options are required."
  echo "  --api-url, --receiver-url, --api-key, --collector-id"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run as root (or with sudo)."
  exit 1
fi

echo "==> Installing Overseer Collector"
echo "    API URL:      $API_URL"
echo "    Receiver URL: $RECEIVER_URL"
echo "    Collector ID: $COLLECTOR_ID"
echo "    API Key:      ${API_KEY:0:12}..."

# ── Create user ───────────────────────────────────────────────────────────────

if ! id "$SERVICE_USER" &>/dev/null; then
  echo "==> Creating system user: $SERVICE_USER"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ── Copy binary ──────────────────────────────────────────────────────────────

if [[ -f "./${BINARY_NAME}" ]]; then
  echo "==> Installing binary from local build"
  cp "./${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo "Error: Binary '${BINARY_NAME}' not found in current directory."
  echo "Build it first:  cd collector && go build -o ${BINARY_NAME} ./cmd/"
  exit 1
fi

chmod 755 "${INSTALL_DIR}/${BINARY_NAME}"

# ── Write config ─────────────────────────────────────────────────────────────

mkdir -p "$CONFIG_DIR"

cat > "${CONFIG_DIR}/collector.env" <<EOF
OVERSEER_API_URL=${API_URL}
OVERSEER_RECEIVER_URL=${RECEIVER_URL}
OVERSEER_API_KEY=${API_KEY}
OVERSEER_COLLECTOR_ID=${COLLECTOR_ID}
# LOG_FORMAT=json
EOF

chmod 600 "${CONFIG_DIR}/collector.env"
chown "$SERVICE_USER":"$SERVICE_USER" "${CONFIG_DIR}/collector.env"

echo "==> Config written to ${CONFIG_DIR}/collector.env"

# ── Create systemd unit ──────────────────────────────────────────────────────

cat > /etc/systemd/system/overseer-collector.service <<EOF
[Unit]
Description=Overseer Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
EnvironmentFile=${CONFIG_DIR}/collector.env
ExecStart=${INSTALL_DIR}/${BINARY_NAME}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-collector

# Hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

echo "==> systemd unit created"

# ── Enable & start ───────────────────────────────────────────────────────────

systemctl daemon-reload
systemctl enable overseer-collector.service
systemctl start overseer-collector.service

echo ""
echo "==> Overseer Collector installed and running!"
echo "    Status:  systemctl status overseer-collector"
echo "    Logs:    journalctl -u overseer-collector -f"
echo "    Config:  ${CONFIG_DIR}/collector.env"
