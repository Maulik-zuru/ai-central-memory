#!/usr/bin/env node
// Cross-platform project setup: creates the Postgres databases, writes .env files, installs
// backend + frontend dependencies, and runs the Prisma migration.
//
// Assumes Node.js and PostgreSQL are already installed and on PATH — that part is OS-specific
// and handled by scripts/setup.sh (macOS/Linux) or scripts/setup.ps1 (Windows), which both call
// this file as their last step. You can also run this file directly if Node + Postgres are
// already set up: `node scripts/setup.mjs`.
//
// Override any of these via environment variables before running:
//   DB_USER      (default: postgres)
//   DB_PASSWORD  (default: postgres)
//   DB_HOST      (default: localhost)
//   DB_PORT      (default: 5432)
//   DB_NAME_DEV  (default: ai_memory_dev)
//   DB_NAME_TEST (default: ai_memory_test)
//   BACKEND_PORT (default: 4000)
//   FRONTEND_PORT (default: 3000)
//   SKIP_INSTALL=1  skip `npm install` (useful for re-runs)
//   SKIP_MIGRATE=1  skip `prisma migrate`

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");

const cfg = {
  dbUser: process.env.DB_USER || "postgres",
  dbPassword: process.env.DB_PASSWORD || "postgres",
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: process.env.DB_PORT || "5432",
  dbNameDev: process.env.DB_NAME_DEV || "ai_memory_dev",
  dbNameTest: process.env.DB_NAME_TEST || "ai_memory_test",
  backendPort: process.env.BACKEND_PORT || "4000",
  frontendPort: process.env.FRONTEND_PORT || "3000",
};

const isWindows = process.platform === "win32";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`\n[${step}] ${msg}`);
}
function ok(msg) {
  console.log(`    ✓ ${msg}`);
}
function warn(msg) {
  console.log(`    ! ${msg}`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: true, ...opts });
}

function runInherited(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true, ...opts });
  return res.status === 0;
}

function commandExists(cmd) {
  const probe = isWindows ? run("where", [cmd]) : run("which", [cmd]);
  return probe.status === 0;
}

// --- 1. Verify prerequisites ---------------------------------------------------------------

log("Checking prerequisites");

if (!commandExists("node")) {
  console.error("    ✗ Node.js was not found on PATH. Install it first (see SETUP.md), then re-run this script.");
  process.exit(1);
}
ok(`node ${run("node", ["-v"]).stdout.trim()}`);

if (!commandExists("psql")) {
  console.error(
    "    ✗ PostgreSQL client (psql) was not found on PATH.\n" +
      "      Install PostgreSQL first (see SETUP.md for platform-specific steps), then re-run this script.",
  );
  process.exit(1);
}
ok(`psql found`);

// --- 2. Create the dev + test databases -----------------------------------------------------

log("Creating databases (if they don't already exist)");

// Different platforms/installs default to different local auth setups (peer auth on most Linux
// apt installs, password auth once PGPASSWORD is set, trust auth on Homebrew's default Postgres).
// Try each strategy in order and use the first one that can actually run a query.
function psqlStrategies(sql) {
  return [
    // Password auth (Windows installer, Docker, most cloud Postgres, or a Linux/mac box where
    // the postgres user's password has already been set to DB_PASSWORD).
    () =>
      run("psql", ["-U", cfg.dbUser, "-h", cfg.dbHost, "-p", cfg.dbPort, "-v", "ON_ERROR_STOP=1", "-c", `"${sql}"`], {
        env: { ...process.env, PGPASSWORD: cfg.dbPassword },
      }),
    // Peer auth via the OS `postgres` user (common on Debian/Ubuntu `apt install postgresql`).
    () => (isWindows ? { status: 1 } : run("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", `"${sql}"`])),
    // Homebrew's default Postgres: the current OS user is the superuser, no password needed.
    () => run("psql", ["postgres", "-v", "ON_ERROR_STOP=1", "-c", `"${sql}"`]),
  ];
}

function runSql(sql, { ignoreIfExists = false } = {}) {
  for (const attempt of psqlStrategies(sql)) {
    const res = attempt();
    if (res.status === 0) return { success: true };
    if (ignoreIfExists && /already exists/i.test(res.stderr || "")) return { success: true, existed: true };
  }
  return { success: false };
}

// Best-effort: make sure the configured user/password actually works, so the app's own
// DATABASE_URL (password auth) connects regardless of how Postgres was installed.
runSql(`ALTER USER ${cfg.dbUser} WITH PASSWORD '${cfg.dbPassword}';`);

for (const dbName of [cfg.dbNameDev, cfg.dbNameTest]) {
  const result = runSql(`CREATE DATABASE ${dbName};`, { ignoreIfExists: true });
  if (result.success) {
    ok(`${dbName} ${result.existed ? "already exists" : "created"}`);
  } else {
    warn(
      `Could not create "${dbName}" automatically. Create it yourself, e.g.:\n` +
        `      psql -U ${cfg.dbUser} -h ${cfg.dbHost} -c "CREATE DATABASE ${dbName};"`,
    );
  }
}

// --- 3. Write .env files (never overwrite an existing one) ----------------------------------

log("Writing environment files");

function ensureEnvFile(dir, targetName, transform) {
  const target = path.join(dir, targetName);
  const example = path.join(dir, ".env.example");
  if (existsSync(target)) {
    ok(`${path.relative(ROOT, target)} already exists — leaving it as-is`);
    return;
  }
  if (!existsSync(example)) {
    warn(`${path.relative(ROOT, example)} not found — skipping`);
    return;
  }
  const content = transform(readFileSync(example, "utf8"));
  writeFileSync(target, content);
  ok(`created ${path.relative(ROOT, target)}`);
}

ensureEnvFile(BACKEND_DIR, ".env", (content) =>
  content
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="postgresql://${cfg.dbUser}:${cfg.dbPassword}@${cfg.dbHost}:${cfg.dbPort}/${cfg.dbNameDev}?schema=public"`)
    .replace(/^PORT=.*$/m, `PORT=${cfg.backendPort}`)
    .replace(/^CORS_ORIGIN=.*$/m, `CORS_ORIGIN="http://localhost:${cfg.frontendPort}"`)
    // Never ship with the placeholder secrets from .env.example — a freshly generated .env
    // gets real random signing keys so a first run isn't accidentally using "change-me-access".
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET="${randomBytes(32).toString("hex")}"`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET="${randomBytes(32).toString("hex")}"`),
);

ensureEnvFile(FRONTEND_DIR, ".env.local", (content) =>
  content.replace(/^NEXT_PUBLIC_API_URL=.*$/m, `NEXT_PUBLIC_API_URL=http://localhost:${cfg.backendPort}`),
);

// --- 4. Install dependencies ------------------------------------------------------------------

if (process.env.SKIP_INSTALL === "1") {
  log("Skipping npm install (SKIP_INSTALL=1)");
} else {
  log("Installing backend dependencies (npm install)");
  if (!runInherited("npm", ["install"], { cwd: BACKEND_DIR })) {
    console.error("    ✗ backend npm install failed — see output above.");
    process.exit(1);
  }

  log("Installing frontend dependencies (npm install)");
  if (!runInherited("npm", ["install"], { cwd: FRONTEND_DIR })) {
    console.error("    ✗ frontend npm install failed — see output above.");
    process.exit(1);
  }
}

// --- 5. Run Prisma migrations ------------------------------------------------------------------

if (process.env.SKIP_MIGRATE === "1") {
  log("Skipping Prisma migration (SKIP_MIGRATE=1)");
} else {
  log("Applying database schema (prisma migrate deploy)");
  if (!runInherited("npx", ["prisma", "migrate", "deploy"], { cwd: BACKEND_DIR })) {
    warn(
      "prisma migrate deploy failed. If this is the very first run, try instead:\n" +
        `      cd backend && npx prisma migrate dev`,
    );
  } else {
    ok("database schema up to date");
  }
}

// --- Done ---------------------------------------------------------------------------------

console.log(`
Setup complete.

Start the backend:
  cd backend && npm run dev        # http://localhost:${cfg.backendPort}

Start the frontend (in a second terminal):
  cd frontend && npm run dev       # http://localhost:${cfg.frontendPort}

See SETUP.md and README.md for more.
`);
