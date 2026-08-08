# AI Memory & Context Platform

An in-house clone of the MemoryPlugin product category: one memory layer shared across AI tools,
built from `docs/Product_Requirements.md`, `docs/Backend_Plan.md`, and `docs/Frontend_Plan.md`.

**Phase 1 (Accounts, Auth & API/Dashboard Foundations) and Phase 2 (Core Memory System) are
implemented.** See `docs/Phase1_Implementation_Plan.md` and `docs/Phase2_Implementation_Plan.md`
for scope, skill mapping, and traceability back to the PRD's `US-ACC-*`/`US-MEM-*` user stories.

## Structure

```
backend/    Express + TypeScript + Prisma (PostgreSQL) API
frontend/   Next.js (App Router) + TypeScript + Tailwind dashboard
docs/       Product requirements and phase-wise build plans
scripts/    Cross-platform setup (see SETUP.md)
```

## Running it locally

### 1. One-command setup

Installs Node.js and PostgreSQL if missing, creates the databases, writes `.env` files, and runs
`npm install` + the Prisma migration — see `SETUP.md` for details, platform notes, and
troubleshooting.

```bash
./scripts/setup.sh        # macOS / Linux
.\scripts\setup.ps1       # Windows (run PowerShell as Administrator)
```

Already have Node + Postgres running? Skip straight to the app-only setup:

```bash
node scripts/setup.mjs
```

### 2. Run it

```bash
cd backend && npm run dev     # http://localhost:4000
cd frontend && npm run dev    # http://localhost:3000 (second terminal)
```

Run the backend test suite (uses the `ai_memory_test` database `scripts/setup.mjs` already created):

```bash
cd backend && npm test
```

### 3. Try it

1. Visit `http://localhost:3000`, register an account.
2. You land on the dashboard shell — Memories/Chat History/Files/Ask/Buckets show "coming soon"
   empty states (they ship in later phases).
3. Go to Settings → API Keys, create a key, copy it, and call a protected endpoint with it:
   ```bash
   curl http://localhost:4000/api/account/me -H "Authorization: Bearer <your-key>"
   ```
4. Revoke the key from the UI — the same curl call immediately starts failing with 401.
5. Settings → Sessions shows your active session; Settings → Privacy has the auto-capture
   consent toggles.
6. Go to Memories, save a couple of near-identical facts — within a couple of seconds a
   "suggestions" badge appears; open it to merge the duplicate or dismiss it.
7. Click into a memory, edit it, and expand "View changes from previous version" to see a
   word-level diff between versions.
8. Upload an image memory (Memories → New memory → Image tab) and it appears in the list with a
   thumbnail.

## Production-hardening pass

Applied against `nodejs-best-practices`, `nodejs-backend-patterns`, `vercel-react-best-practices`,
and `vercel-composition-patterns`:

- **Backend:** structured request/error logging (pino + pino-http, with auth headers/cookies
  redacted), gzip compression, a DB-backed `/api/health` check, a request body size cap, `trust
  proxy` for correct client IPs behind a load balancer, and graceful shutdown on
  `SIGTERM`/`SIGINT` (drains in-flight requests, disconnects Prisma, force-exits after a timeout).
- **Frontend:** React 19 idiomatic components (`ref` as a plain prop instead of `forwardRef`), and
  an optimistic auth check in `src/proxy.ts` that redirects at the edge before a page ships to the
  browser — the same real authorization still happens client-side and on every API call; the proxy
  only removes the flash of the wrong screen on load/reload.
- A real bug surfaced and fixed during this pass: the refresh cookie was scoped to
  `Path=/api/auth`, which made it invisible to the frontend's own routes and broke the proxy check
  entirely. It's now `Path=/`, with a regression test in `backend/tests/auth.test.ts` asserting it.

## Known simplifications (Phase 2)

- **No real job queue.** Embedding generation runs as an in-process fire-and-forget call, not a
  Redis/BullMQ job — see `docs/Phase2_Implementation_Plan.md` §10 for why, and what a real queue
  would change.
- **Duplicate/stale similarity thresholds** are calibrated against the deterministic stub
  embedding provider (no LLM API key configured). Set `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in
  `backend/.env` to use real providers — the thresholds will likely need re-tuning against real
  embeddings' distance distribution.
- **Image storage is local-disk only** (`backend/uploads/`), fine for local dev, not for a real
  deployment — the `StorageProvider` interface is ready for an S3-compatible implementation.

## What's deferred

Buckets-with-sharing, chat-archive/file/Ask features, real Google OAuth credentials, Stripe
billing, and data export/deletion are out of scope through Phase 2 — see
`docs/Phase1_Implementation_Plan.md` §2 and `docs/Phase2_Implementation_Plan.md` §2 for the full
in-scope/out-of-scope breakdown and which later phase picks each one up.
