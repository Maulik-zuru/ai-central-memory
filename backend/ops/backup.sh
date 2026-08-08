#!/usr/bin/env bash
# Backup one MemoryOS Postgres database to a compressed custom-format dump.
#
#   ./ops/backup.sh "postgresql://user:pass@host:5432/db" ./backups
#
# Custom format (-Fc), not plain SQL: it restores selectively, in parallel, and compresses — the
# properties that matter when a restore is happening under pressure.
set -euo pipefail

DATABASE_URL="${1:?usage: backup.sh <database-url> [output-dir]}"
OUT_DIR="${2:-./backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/memoryos-${STAMP}.dump"

echo "Backing up to ${OUT_FILE}"
pg_dump --format=custom --no-owner --no-privileges --file="$OUT_FILE" "$DATABASE_URL"

# A dump that cannot be listed is a dump that will not restore. Verify now, not during an outage.
pg_restore --list "$OUT_FILE" > /dev/null
echo "Backup verified readable: $(du -h "$OUT_FILE" | cut -f1)"
