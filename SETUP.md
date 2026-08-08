# Setup

One command sets up everything this project needs: Node.js, PostgreSQL, the two databases,
`.env` files, npm dependencies, and the Prisma schema.

## Quick start

**macOS / Linux:**

```bash
./scripts/setup.sh
```

**Windows** (run PowerShell as Administrator — `winget install` needs it):

```powershell
.\scripts\setup.ps1
```

That's it. When it finishes:

```bash
cd backend && npm run dev    # http://localhost:4000
cd frontend && npm run dev   # http://localhost:3000 (in a second terminal)
```

Both scripts are safe to re-run — every step checks whether it's already done (Node installed?
Postgres running? database exists? `.env` present?) before doing anything, so re-running after a
partial failure just picks up where it left off.

## What it actually does

1. **Installs Node.js 20+** if missing (Homebrew on macOS, apt/dnf/pacman on Linux, winget on
   Windows).
2. **Installs PostgreSQL 16** if missing (same package managers).
3. **Installs the pgvector extension** (Phase 2's memory similarity search needs it) — via the
   same package managers on macOS/Linux; on Windows this is a checked prerequisite with manual
   install steps printed, since there's no winget package for it (see Platform notes).
4. **Starts the PostgreSQL service** if it isn't running.
5. Hands off to `scripts/setup.mjs`, which:
   - Creates the `ai_memory_dev` and `ai_memory_test` databases (skips ones that already exist)
   - Writes `backend/.env` and `frontend/.env.local` from their `.env.example` templates —
     **only if they don't already exist**, so it never clobbers config you've customized — with
     freshly generated random JWT signing secrets rather than the example's placeholders
   - Runs `npm install` in both `backend/` and `frontend/`
   - Runs `npx prisma migrate deploy` to bring the database schema up to date

## Platform notes

**macOS:** Requires [Homebrew](https://brew.sh). If Homebrew isn't installed, the script tells you
and stops — install it once, then re-run.

**Linux:** Auto-detects `apt`, `dnf`, or `pacman`. Needs `sudo` for package installation and
service management (you'll get the normal sudo password prompt).

**Windows:** Requires [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/)
(preinstalled on Windows 10 2004+ and Windows 11). The PostgreSQL installer sets its own superuser
password interactively during install — if you're prompted, note the password, then before
re-running the script:

```powershell
$env:DB_PASSWORD = "the-password-you-set"
```

If `psql` or `node` still isn't found immediately after an install, close and reopen PowerShell
(PATH changes need a fresh shell) and run the script again.

**pgvector on Windows:** no winget package exists. Install it via the PostgreSQL installer's
bundled **Application Stack Builder** (Start Menu → PostgreSQL 16 → Application Stack Builder →
Spatial Extensions → pgVector) or a prebuilt release from
[github.com/pgvector/pgvector](https://github.com/pgvector/pgvector#installation). If this is
skipped, `scripts/setup.mjs`'s migration step fails with a clear Postgres error
(`extension "vector" is not available`) rather than silently succeeding.

## Configuration

Every default can be overridden with an environment variable before running
`node scripts/setup.mjs` directly (or export them before calling `setup.sh`/`setup.ps1`):

| Variable | Default | Purpose |
|---|---|---|
| `DB_USER` | `postgres` | Postgres role used by the app |
| `DB_PASSWORD` | `postgres` | Password for that role |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_NAME_DEV` | `ai_memory_dev` | Dev database name |
| `DB_NAME_TEST` | `ai_memory_test` | Test database name (used by `npm test` in `backend/`) |
| `BACKEND_PORT` | `4000` | Backend server port |
| `FRONTEND_PORT` | `3000` | Frontend dev server port |
| `SKIP_INSTALL` | unset | Set to `1` to skip `npm install` (fast re-runs) |
| `SKIP_MIGRATE` | unset | Set to `1` to skip the Prisma migration |

Example — different ports and database names:

```bash
DB_NAME_DEV=my_dev_db BACKEND_PORT=5000 ./scripts/setup.sh
```

## Troubleshooting

**"Could not create database automatically"** — the script's three connection strategies (password
auth, Linux peer auth via `sudo -u postgres`, Homebrew trust auth) didn't match your Postgres
setup. Create the databases yourself and re-run:

```bash
psql -U postgres -h localhost -c "CREATE DATABASE ai_memory_dev;"
psql -U postgres -h localhost -c "CREATE DATABASE ai_memory_test;"
```

**Re-running after changing `.env` by hand** — the script never overwrites an existing `.env` or
`.env.local`. To regenerate one from scratch, delete it first, then re-run.

**Running just the app-setup step** (Node + Postgres already installed and running):

```bash
node scripts/setup.mjs
```
