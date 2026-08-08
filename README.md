# AI Memory & Context Platform

An in-house clone of the MemoryPlugin product category: one memory layer shared across AI tools,
built from `docs/Product_Requirements.md`, `docs/Backend_Plan.md`, and `docs/Frontend_Plan.md`.

**Phase 1 (Accounts, Auth & API/Dashboard Foundations) is implemented.** See
`docs/Phase1_Implementation_Plan.md` for scope, skill mapping, and traceability back to the PRD's
`US-ACC-*` user stories.

## Structure

```
backend/    Express + TypeScript + Prisma (PostgreSQL) API
frontend/   Next.js (App Router) + TypeScript + Tailwind dashboard
docs/       Product requirements and phase-wise build plans
```

## Running Phase 1 locally

### 1. Backend

```bash
cd backend
cp .env.example .env   # adjust DATABASE_URL if your Postgres isn't on localhost:5432
npm install
npx prisma migrate dev
npm run dev             # http://localhost:4000
```

Run the test suite (needs a second Postgres database, e.g. `ai_memory_test`):

```bash
npm test
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev              # http://localhost:3000
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

## What's deferred

Memory/bucket/chat-archive/file/Ask features, real Google OAuth credentials, Stripe billing, and
data export/deletion are out of scope for Phase 1 — see `docs/Phase1_Implementation_Plan.md` §2 for
the full in-scope/out-of-scope breakdown and which later phase picks each one up.
