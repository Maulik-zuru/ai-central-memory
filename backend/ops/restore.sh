#!/usr/bin/env bash
# Restore a dump produced by backup.sh into a target database.
#
#   ./ops/restore.sh ./backups/memoryos-<stamp>.dump "postgresql://user:pass@host:5432/target"
#
# --clean --if-exists so a restore over a populated database is deterministic rather than
# half-merging into whatever was already there.
set -euo pipefail

DUMP_FILE="${1:?usage: restore.sh <dump-file> <target-database-url>}"
TARGET_URL="${2:?usage: restore.sh <dump-file> <target-database-url>}"

echo "Restoring ${DUMP_FILE} -> ${TARGET_URL}"
# pgvector must exist before the dump's vector-typed columns can be created.
psql "$TARGET_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_URL" "$DUMP_FILE"
echo "Restore complete."
