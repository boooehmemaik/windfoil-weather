#!/usr/bin/env bash
# WindFoil — tägliches DB-Backup (cron-tauglich)
# Aufruf: ./scripts/backup-db.sh [snapshot-label]
# Legt Backups in $BACKUP_DIR ab (default: /var/backups/windfoil).
# Hält die letzten KEEP_DAYS Tage (default: 7).
set -euo pipefail

LABEL="${1:-daily}"
BACKUP_DIR="${WINDFOIL_BACKUP_DIR:-/var/backups/windfoil}"
KEEP_DAYS="${WINDFOIL_BACKUP_KEEP:-7}"

cd "$(dirname "$(readlink -f "$0")")/.."
if [ -f windfoil.env ]; then set -a; . ./windfoil.env; set +a; fi

DB_PATH="${WINDFOIL_DB_PATH:-$(pwd)/data/windfoil.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "SKIP: DB-Datei nicht gefunden: $DB_PATH"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y%m%d-%H%M%S)
DEST="$BACKUP_DIR/windfoil-${LABEL}-${STAMP}.db"

# SQLite .backup ist WAL-sicher (kein Lock auf Production nötig).
sqlite3 "$DB_PATH" ".backup '$DEST'"
echo "Backup: $DEST ($(du -sh "$DEST" | cut -f1))"

# Alte Backups aufräumen (nur Dateien, die zu diesem Label gehören).
find "$BACKUP_DIR" -name "windfoil-${LABEL}-*.db" -mtime "+${KEEP_DAYS}" -delete
REMAINING=$(find "$BACKUP_DIR" -name "windfoil-${LABEL}-*.db" | wc -l)
echo "Backups behalten: $REMAINING"
