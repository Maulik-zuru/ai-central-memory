#!/usr/bin/env bash
# One-command sync after pulling new code: pulls, installs any changed dependencies,
# applies new Prisma migrations, and regenerates the Prisma client.
#
# Usage:
#   ./scripts/sync.sh
#
# Safe to re-run: git pull is a no-op when up to date, npm install is a no-op when
# package.json/lockfile didn't change, and prisma migrate deploy only applies
# migrations that aren't already recorded in the database.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "==> AI Memory & Context Platform — sync"

# --- 1. Pull latest code -----------------------------------------------------------------------

echo ""
echo "[1] Pulling latest code (git pull)"
BEFORE_BACKEND_PKG="$(git -C "$ROOT_DIR" hash-object backend/package-lock.json 2>/dev/null || echo none)"
BEFORE_FRONTEND_PKG="$(git -C "$ROOT_DIR" hash-object frontend/package-lock.json 2>/dev/null || echo none)"
BEFORE_BACKEND_SCHEMA="$(git -C "$ROOT_DIR" hash-object backend/prisma/schema.prisma 2>/dev/null || echo none)"

git pull

AFTER_BACKEND_PKG="$(git -C "$ROOT_DIR" hash-object backend/package-lock.json 2>/dev/null || echo none)"
AFTER_FRONTEND_PKG="$(git -C "$ROOT_DIR" hash-object frontend/package-lock.json 2>/dev/null || echo none)"

# --- 2. Install dependencies (only if lockfiles changed) --------------------------------------

echo ""
echo "[2] Installing dependencies"
if [ "$BEFORE_BACKEND_PKG" != "$AFTER_BACKEND_PKG" ]; then
  echo "    backend/package-lock.json changed — running npm install"
  (cd "$BACKEND_DIR" && npm install)
else
  echo "    backend: no lockfile changes, skipping npm install"
fi

if [ "$BEFORE_FRONTEND_PKG" != "$AFTER_FRONTEND_PKG" ]; then
  echo "    frontend/package-lock.json changed — running npm install"
  (cd "$FRONTEND_DIR" && npm install)
else
  echo "    frontend: no lockfile changes, skipping npm install"
fi

# --- 3. Apply new Prisma migrations -------------------------------------------------------------

echo ""
echo "[3] Applying database migrations (prisma migrate deploy)"
(cd "$BACKEND_DIR" && npx prisma migrate deploy)

# --- 4. Regenerate Prisma client (covers schema changes without a new migration, e.g. mid-dev) --

echo ""
echo "[4] Regenerating Prisma client"
(cd "$BACKEND_DIR" && npx prisma generate)

echo ""
echo "==> Sync complete."
echo ""
echo "Start the backend:"
echo "  cd backend && npm run dev        # http://localhost:4000"
echo ""
echo "Start the frontend (in a second terminal):"
echo "  cd frontend && npm run dev       # http://localhost:3000"
