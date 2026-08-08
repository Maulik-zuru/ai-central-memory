#!/usr/bin/env bash
# One-command setup for macOS and Linux: installs Node.js and PostgreSQL if they're missing,
# starts Postgres, then hands off to scripts/setup.mjs for the app-specific setup (databases,
# .env files, npm installs, migrations).
#
# Usage:
#   ./scripts/setup.sh
#
# Safe to re-run: every step checks whether it's already done before doing anything.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> AI Memory & Context Platform — setup (macOS/Linux)"

OS="$(uname -s)"

have() { command -v "$1" >/dev/null 2>&1; }

# --- 1. Node.js -------------------------------------------------------------------------------

if have node; then
  echo "==> Node.js already installed: $(node -v)"
else
  echo "==> Node.js not found — installing…"
  if [ "$OS" = "Darwin" ]; then
    if ! have brew; then
      echo "    Homebrew not found. Install it from https://brew.sh, then re-run this script."
      exit 1
    fi
    brew install node@20
    brew link --overwrite node@20
  elif [ "$OS" = "Linux" ]; then
    if have apt-get; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif have dnf; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
      sudo dnf install -y nodejs
    elif have pacman; then
      sudo pacman -Sy --noconfirm nodejs npm
    else
      echo "    Unrecognized Linux package manager. Install Node.js 20+ manually from https://nodejs.org, then re-run this script."
      exit 1
    fi
  else
    echo "    Unrecognized OS ($OS). Install Node.js 20+ manually from https://nodejs.org, then re-run this script."
    exit 1
  fi
  echo "==> Installed Node.js: $(node -v)"
fi

# --- 2. PostgreSQL ----------------------------------------------------------------------------

if have psql; then
  echo "==> PostgreSQL client already installed"
else
  echo "==> PostgreSQL not found — installing…"
  if [ "$OS" = "Darwin" ]; then
    if ! have brew; then
      echo "    Homebrew not found. Install it from https://brew.sh, then re-run this script."
      exit 1
    fi
    brew install postgresql@16
    brew link --overwrite postgresql@16
  elif [ "$OS" = "Linux" ]; then
    if have apt-get; then
      sudo apt-get update
      sudo apt-get install -y postgresql postgresql-contrib
    elif have dnf; then
      sudo dnf install -y postgresql-server postgresql-contrib
      sudo postgresql-setup --initdb || true
    elif have pacman; then
      sudo pacman -Sy --noconfirm postgresql
      sudo -u postgres initdb -D /var/lib/postgres/data || true
    else
      echo "    Unrecognized Linux package manager. Install PostgreSQL manually, then re-run this script."
      exit 1
    fi
  else
    echo "    Unrecognized OS ($OS). Install PostgreSQL manually, then re-run this script."
    exit 1
  fi
fi

# --- 2b. pgvector (Phase 2: memory embeddings/similarity search) -----------------------------
# Not bundled with Postgres itself — a separate extension package, installed regardless of
# whether Postgres itself was just installed or already present.

echo "==> Ensuring the pgvector extension is installed"
if [ "$OS" = "Darwin" ] && have brew; then
  brew install pgvector || true
elif [ "$OS" = "Linux" ]; then
  PG_VERSION="$(psql --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
  if have apt-get; then
    sudo apt-get install -y "postgresql-${PG_VERSION}-pgvector" || \
      echo "    ! Could not install postgresql-${PG_VERSION}-pgvector automatically. Install pgvector manually: https://github.com/pgvector/pgvector#installation"
  elif have dnf; then
    sudo dnf install -y pgvector || \
      echo "    ! Could not install pgvector automatically. Install it manually: https://github.com/pgvector/pgvector#installation"
  elif have pacman; then
    sudo pacman -Sy --noconfirm pgvector || \
      echo "    ! Could not install pgvector automatically. Install it manually: https://github.com/pgvector/pgvector#installation"
  fi
fi

# --- 3. Make sure Postgres is actually running ------------------------------------------------

echo "==> Ensuring PostgreSQL is running"
if have pg_isready && pg_isready -q 2>/dev/null; then
  echo "    already running"
elif [ "$OS" = "Darwin" ] && have brew; then
  brew services start postgresql@16 || brew services start postgresql || true
  sleep 2
elif [ "$OS" = "Linux" ]; then
  if have systemctl; then
    sudo systemctl enable --now postgresql || true
  elif have service; then
    sudo service postgresql start || true
  elif have pg_ctlcluster; then
    # Debian/Ubuntu without systemd (e.g. some containers) — start the newest cluster directly.
    CLUSTER_VERSION="$(pg_lsclusters 2>/dev/null | awk 'NR==2{print $1}')"
    [ -n "$CLUSTER_VERSION" ] && sudo pg_ctlcluster "$CLUSTER_VERSION" main start || true
  fi
  sleep 2
fi

if have pg_isready && ! pg_isready -q 2>/dev/null; then
  echo "    ! Could not confirm PostgreSQL is running. The next step may fail — start it manually and re-run."
fi

# --- 4. Hand off to the cross-platform setup script --------------------------------------------

echo "==> Running app setup (databases, .env files, npm install, migrations)"
node "$ROOT_DIR/scripts/setup.mjs"
