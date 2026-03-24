#!/usr/bin/env bash
# Overseer Collector – Install Script
# Usage: sudo bash install-collector.sh
#
# Environment variables (set before running or provide interactively):
#   OVERSEER_API_URL        e.g. https://overseer.example.com
#   OVERSEER_RECEIVER_URL   e.g. https://overseer.example.com
#   OVERSEER_API_KEY        API key for this collector
#   OVERSEER_COLLECTOR_ID   UUID of this collector in the DB

set -euo pipefail

INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/overseer"
SERVICE_FILE="/etc/systemd/system/overseer-collector.service"
BINARY_NAME="overseer-collector"
REPO_URL="${OVERSEER_REPO_URL:-}"  # optional: pre-built binary URL

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install-collector.sh"

# ── Collect config interactively if not set ───────────────────────────────────
prompt() {
  local var="$1" prompt="$2" default="${3:-}"
  if [[ -z "${!var:-}" ]]; then
    read -rp "$prompt${default:+ [$default]}: " val
    eval "$var=\"${val:-$default}\""
  fi
}

prompt OVERSEER_API_URL      "Overseer API URL"
prompt OVERSEER_RECEIVER_URL "Overseer Receiver URL" "${OVERSEER_API_URL:-}"
prompt OVERSEER_API_KEY      "API Key for this collector"
prompt OVERSEER_COLLECTOR_ID "Collector UUID (from DB)"

[[ -z "$OVERSEER_API_KEY" ]]      && error "OVERSEER_API_KEY is required"
[[ -z "$OVERSEER_COLLECTOR_ID" ]] && error "OVERSEER_COLLECTOR_ID is required"

# ── Build or download binary ──────────────────────────────────────────────────
info "Looking for pre-built binary..."
if [[ -f "/tmp/$BINARY_NAME" ]]; then
  info "Using /tmp/$BINARY_NAME"
  BINARY_SRC="/tmp/$BINARY_NAME"
elif command -v go &>/dev/null; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COLLECTOR_DIR="$(realpath "$SCRIPT_DIR/../collector")"
  if [[ -d "$COLLECTOR_DIR" ]]; then
    info "Building from source: $COLLECTOR_DIR"
    (cd "$COLLECTOR_DIR" && go build -o "/tmp/$BINARY_NAME" ./cmd/)
    BINARY_SRC="/tmp/$BINARY_NAME"
  else
    error "Collector source not found at $COLLECTOR_DIR. Place a pre-built binary at /tmp/$BINARY_NAME."
  fi
else
  error "Go not installed and no pre-built binary at /tmp/$BINARY_NAME."
fi

# ── Install binary ────────────────────────────────────────────────────────────
info "Installing binary to $INSTALL_DIR/$BINARY_NAME"
install -m 755 "$BINARY_SRC" "$INSTALL_DIR/$BINARY_NAME"

# ── Write config ──────────────────────────────────────────────────────────────
info "Writing config to $CONFIG_DIR/collector.env"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

cat > "$CONFIG_DIR/collector.env" <<EOF
OVERSEER_API_URL=$OVERSEER_API_URL
OVERSEER_RECEIVER_URL=$OVERSEER_RECEIVER_URL
OVERSEER_API_KEY=$OVERSEER_API_KEY
OVERSEER_COLLECTOR_ID=$OVERSEER_COLLECTOR_ID
EOF
chmod 600 "$CONFIG_DIR/collector.env"

# ── Create dedicated user ─────────────────────────────────────────────────────
if ! id -u overseer &>/dev/null; then
  info "Creating system user 'overseer'"
  useradd --system --no-create-home --shell /usr/sbin/nologin overseer
fi
chown -R overseer:overseer "$CONFIG_DIR"

# ── Install systemd unit ──────────────────────────────────────────────────────
info "Installing systemd unit: $SERVICE_FILE"
cat > "$SERVICE_FILE" <<'UNIT'
[Unit]
Description=Overseer Monitoring Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=overseer
EnvironmentFile=/etc/overseer/collector.env
ExecStart=/usr/local/bin/overseer-collector
Restart=on-failure
RestartSec=15s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-collector

[Install]
WantedBy=multi-user.target
UNIT

# ── Enable + start ────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable overseer-collector
systemctl restart overseer-collector

info "Done! Check status with: journalctl -u overseer-collector -f"
sleep 2
systemctl status overseer-collector --no-pager || true
