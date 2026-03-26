#!/bin/bash
# check_uptime.sh — Text-Output Beispiel
# Gibt die Uptime in Tagen aus. Der erste numerische Wert im Output
# wird automatisch als "value" extrahiert.
#
# Expected output: text
# Exit codes: 0=OK, 1=CRITICAL

UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)

if [ -z "$UPTIME_SEC" ]; then
    echo "Could not read uptime"
    exit 1
fi

UPTIME_DAYS=$(( UPTIME_SEC / 86400 ))
UPTIME_HOURS=$(( (UPTIME_SEC % 86400) / 3600 ))

echo "${UPTIME_DAYS} Tage, ${UPTIME_HOURS} Stunden"
exit 0
