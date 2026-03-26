#!/bin/bash
# check_backup_dailycrust.sh — Nagios-compatible backup check
# Checks DailyCrust SQLite backups for age and size.
#
# Expected output: nagios
# Exit codes: 0=OK, 1=WARNING, 2=CRITICAL
#
# Thresholds (configurable via env, defaults below):
#   MAX_AGE_WARN  — hours before WARNING  (default: 26)
#   MAX_AGE_CRIT  — hours before CRITICAL (default: 50)
#   MIN_SIZE      — minimum bytes          (default: 1000)

BACKUP_DIR="/var/backups/dailycrust"
MAX_AGE_WARN="${MAX_AGE_WARN:-26}"
MAX_AGE_CRIT="${MAX_AGE_CRIT:-50}"
MIN_SIZE="${MIN_SIZE:-1000}"

# Find newest backup file
NEWEST=$(find "$BACKUP_DIR" -maxdepth 1 -name 'backup_*.db.gz' -type f -printf '%T@\t%p\n' 2>/dev/null | sort -rn | head -1)

if [ -z "$NEWEST" ]; then
    echo "CRITICAL - No backups found in $BACKUP_DIR"
    exit 2
fi

FILE=$(echo "$NEWEST" | cut -f2)
FILENAME=$(basename "$FILE")
FILE_SIZE=$(stat -c %s "$FILE" 2>/dev/null || echo 0)
FILE_MTIME=$(stat -c %Y "$FILE" 2>/dev/null || echo 0)
NOW=$(date +%s)
AGE_SECONDS=$(( NOW - FILE_MTIME ))
AGE_HOURS=$(( AGE_SECONDS / 3600 ))

# Size in human-readable
if [ "$FILE_SIZE" -ge 1048576 ]; then
    SIZE_HR="$(awk "BEGIN {printf \"%.1f\", $FILE_SIZE/1048576}") MB"
elif [ "$FILE_SIZE" -ge 1024 ]; then
    SIZE_HR="$(awk "BEGIN {printf \"%.1f\", $FILE_SIZE/1024}") KB"
else
    SIZE_HR="${FILE_SIZE} B"
fi

# Check size
if [ "$FILE_SIZE" -lt "$MIN_SIZE" ]; then
    echo "CRITICAL - Backup $FILENAME too small (${SIZE_HR}, min $(( MIN_SIZE / 1024 )) KB) | age=${AGE_HOURS}h size=${FILE_SIZE}B"
    exit 2
fi

# Check age
if [ "$AGE_HOURS" -ge "$MAX_AGE_CRIT" ]; then
    echo "CRITICAL - Backup $FILENAME is ${AGE_HOURS}h old (max ${MAX_AGE_CRIT}h), ${SIZE_HR} | age=${AGE_HOURS}h size=${FILE_SIZE}B"
    exit 2
elif [ "$AGE_HOURS" -ge "$MAX_AGE_WARN" ]; then
    echo "WARNING - Backup $FILENAME is ${AGE_HOURS}h old (max ${MAX_AGE_WARN}h), ${SIZE_HR} | age=${AGE_HOURS}h size=${FILE_SIZE}B"
    exit 1
fi

echo "OK - Backup $FILENAME (${AGE_HOURS}h old, ${SIZE_HR}) | age=${AGE_HOURS}h size=${FILE_SIZE}B"
exit 0
