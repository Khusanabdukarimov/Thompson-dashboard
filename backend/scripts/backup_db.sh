#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Mountain SQLite DB backup script
# ══════════════════════════════════════════════════════════════════════════════
# Cron-friendly backup of /var/www/mountain/backend/data/mountain.db
#
# Usage:
#   ./backup_db.sh                     # backup to default dir
#   BACKUP_DIR=/path ./backup_db.sh    # custom destination
#
# Crontab example (daily 3am, keep last 14):
#   0 3 * * * /var/www/mountain/backend/scripts/backup_db.sh >> /var/log/mountain-backup.log 2>&1

set -e

DB_FILE="${DB_FILE:-/var/www/mountain/backend/data/mountain.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/www/mountain/backend/data/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# Ensure backup dir exists
mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
    echo "$(date -Iseconds) ERROR: DB file not found: $DB_FILE" >&2
    exit 1
fi

# Use sqlite .backup command for safe live-DB copy (handles WAL/locks correctly)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEST="$BACKUP_DIR/mountain-$TIMESTAMP.db"

if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_FILE" ".backup '$DEST'"
else
    # Fallback: simple file copy (less safe under heavy writes, but OK for our scale)
    cp "$DB_FILE" "$DEST"
fi

# Compress the backup
gzip -f "$DEST"

# Prune old backups (older than KEEP_DAYS)
find "$BACKUP_DIR" -name 'mountain-*.db.gz' -mtime "+$KEEP_DAYS" -delete

# Report
COUNT=$(find "$BACKUP_DIR" -name 'mountain-*.db.gz' | wc -l | tr -d ' ')
LATEST_SIZE=$(du -h "$DEST.gz" | cut -f1)
echo "$(date -Iseconds) ✓ backup: $DEST.gz ($LATEST_SIZE, total $COUNT files in $BACKUP_DIR)"
