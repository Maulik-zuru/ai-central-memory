# Phase 12 Implementation Plan — QA, Performance & Launch Readiness

**Source documents:** `Product_Requirements.md` §8 (Non-Functional Requirements), `Backend_Plan.md`
Phase 12, `Frontend_Plan.md` Phase 12
**Companion document:** `Phase11_Implementation_Plan.md` — that phase closes the account-level
trust gaps; this one closes the operational ones. Together they're the last two phases before the
PRD's own "general availability" milestone (§8's staged-rollout plan, below).

---

## 1. Objective

> Documented load-test results within target latency/error budgets; a successful backup-restore
> drill on record (backend exit criteria). Green accessibility/perf budgets in CI; onboarding
> completes end-to-end on desktop and mobile web (frontend exit criteria).

Every prior phase built a feature and proved it works once, by hand, against a small seeded
account. This phase is the first to ask "does it still work at realistic scale, under real load,
after a real failure, on a real phone" — and to make the answer something CI checks on every
change instead of something re-verified by hand each time.

## 2. What already exists vs. what's net-new

| Capability | Status |
|---|---|
| Structured logging | **Exists** (Phase 1) — `logger.ts`'s pino setup, `pino-http` request-scoped child loggers wired in `app.ts`. This phase's monitoring/alerting builds on this, not a new logging library |
| Test suite | **Exists and is substantial** — 15 backend test files (`backend/tests/`), covering every phase's acceptance criteria via `supertest` + a real Postgres. No coverage threshold enforced (`package.json`'s `test` script has no `--coverage` flag) |
| Rate limiting | **Exists** (Phase 1) — `rateLimit.ts`'s three limiters already bound request volume per user/IP; relevant context for load-test *targets* (a load test should confirm behavior at and past these limits, not treat them as an obstacle to route around) |
| Cursor-based pagination | **Exists** (multiple phases) — memories, conversations, files, Ask threads all paginate via `cursor`/`limit` (`api.ts`'s `memories()`/`conversations()`/`files()`/`askThreads()`). This meaningfully reduces (but doesn't eliminate) the urgency of list virtualization, since no list currently renders an unbounded DOM |
| pgvector index tuning | **Does not exist** — `grep -n "ivfflat\|hnsw" backend/prisma/**` returns nothing; every similarity query (`retrieval.service.ts`, `chat-search.service.ts`, `file-search.service.ts`, `ask.service.ts`) runs an exact sequential scan (`<=>` with no index) over `Memory`/`MessageChunk`/`FileChunk`. Correct today because seeded test accounts are small; the first thing that will actually break under realistic data volume |
| Connection pooling config | **Does not exist** — no `connection_limit` on `DATABASE_URL`, no PgBouncer/pooler mentioned anywhere. Prisma's default pool size (`num_cpus * 2 + 1`) is what's running today, unreviewed |
| Image optimization | **Does not exist** — `memory-row.tsx:41` and `memories/[id]/page.tsx:93` both render plain `<img>` tags against `memoryImageSrc()`; `next.config.ts` is the bare default `NextConfig` with no `images` block. `next/image` is not used anywhere in the codebase |
| CI pipeline | **Does not exist** — no `.github/workflows/` directory in the repo at all. Every test run, lint, and build check to date has been manual |
| Accessibility tooling | **Does not exist** — no axe/pa11y/lighthouse devDependency in either `package.json`. Individual components (e.g. `graph-explorer.tsx`'s SVG nodes) were built with keyboard/`aria-label` support by convention, but nothing has verified this systematically or across the whole app |
| Load-testing tooling | **Does not exist** — no k6/autocannon/artillery reference anywhere. Every "verify the exit criteria" step in every prior phase's plan has meant one hand-run request, never a sustained load profile |
| Backup/DR process | **Does not exist** — no backup script, no documented restore procedure; this is entirely infra/ops territory this codebase hasn't touched yet |
| Cross-browser/extension verification | **Explicitly flagged as unverified already** — `extension/src/lib/site-adapters/chatgpt.ts:3-6`'s own comment: *"has not been verified against a live, authenticated ChatGPT session in this environment... a real, still-open step"* — the same is true of the Claude and Gemini adapters. This phase is where that flag gets resolved, not a new discovery |

## 3. In scope / out of scope

**In scope**
- **Load testing** the two most compute-heavy paths (`Backend_Plan.md`'s own naming): retrieval
  (`GET /api/context/preview` → `retrieval.service.buildContext()`) and Ask
  (`POST /api/ask` → `ask.service.ask()`, which fans out to memories/chat-history/files
  concurrently) — establishing a p95 latency budget and confirming it's met at a realistic
  concurrent-user profile, not just a cold single request
- **pgvector index tuning**: adding `ivfflat` or `hnsw` indexes to `Memory.embedding`,
  `MessageChunk.embedding`, `FileChunk.embedding` (whichever this Postgres/pgvector version
  supports well — see §4), with a documented trigger for "outgrew pgvector, migrate to a dedicated
  vector DB" rather than migrating speculatively now
- **Connection pooling review**: an explicit, documented `connection_limit` decision for
  `DATABASE_URL`, sized against the deployment's expected concurrency, not left at Prisma's default
  by omission
- **Monitoring/alerting** on: sync-job failure rate (`Conversation.status: 'error'` rows),
  embedding-job backlog (`Memory.embedding IS NULL` age), and LLM API error rates (every provider's
  already-logged `res.status`-not-ok branches, aggregated) — built on the existing pino/structured
  logging, not a new observability stack
- **CI pipeline**: a GitHub Actions workflow running `tsc --noEmit`, the full backend test suite
  against a real Postgres service container, and `next build` on every PR — the first automated
  gate this codebase has had
- **Backup/DR drill**: a documented `pg_dump`/`pg_restore` procedure, executed once for real against
  a copy of seeded data, with the restore verified by re-running a subset of the backend test suite
  against the restored database
- **Staged rollout plan**: a written internal → beta cohort → GA plan (a document, not code) —
  what "beta cohort" means for a system with per-user data isolation already built in since Phase 3
- **Accessibility audit**: axe-core wired into CI against the app's key screens (dashboard,
  memories, buckets, chat history, files, Ask, intelligence, settings, billing, pricing), fixing
  what it finds — WCAG 2.1 AA per the PRD's own NFR table
- **Performance pass**: `next/image` adoption for the two `<img>` call sites, route-level code
  splitting audit (Next's App Router does this by default per route — confirming nothing
  accidentally defeats it), Lighthouse CI budget enforcement
- **Cross-browser/extension compatibility pass**: manually verifying the three site adapters
  (ChatGPT, Claude, Gemini) against live, authenticated sessions — the specific gap the codebase has
  already flagged (§2) — plus a Firefox/Safari smoke pass on the main dashboard
- **Onboarding polish**: first-run empty states across every module (most already exist per-phase;
  this is an audit-and-polish pass, not new empty-state design) plus a guided first-time tour
- **Mobile-web pass**: iOS Safari and Android Chrome smoke-testing the dashboard's responsive
  behavior, since nothing in Phases 1–11 was built mobile-first

**Explicitly out of scope this phase**
- **Migrating off pgvector to a dedicated vector database** — §4 explicitly frames index tuning as
  the fix for *this* phase's scale target, with a documented trigger for when a real migration
  becomes justified. Migrating now, without load-test evidence that indexing alone is insufficient,
  would be solving a problem this phase hasn't yet proven exists
- **A native mobile app** — `Frontend_Plan.md`'s own scope note: "native app explicitly out of
  scope for v1." This phase's mobile work is responsive web only
- **Building a custom APM/metrics platform** — monitoring/alerting here means structured log
  queries and a small number of documented alert conditions on infrastructure already in place
  (pino), not standing up Prometheus/Grafana/Datadog as new infrastructure this phase would then
  also own maintaining
- **Actually executing the staged rollout** — this phase produces the *plan* as its deliverable;
  running the beta cohort and flipping to GA is a post-Phase-12 operational activity, not something
  a code change can "complete"

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| pgvector index (`ivfflat` or `hnsw`) | Every vector similarity query in the codebase (`retrieval.service.ts:65-72`, `chat-search.service.ts`, `file-search.service.ts`, `categorization.service.ts`) runs an unindexed `<=>` scan today — fine at seed-data scale, the first thing that degrades under real volume | A migration adding `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops)` (or `hnsw` if the deployed pgvector version supports it — a one-line version check against what's already running, not a speculative choice) on each embedding column, with `lists`/`m`/`ef_construction` parameters chosen from a documented back-of-envelope calc against expected row counts, not copied from a tutorial unexamined |
| GitHub Actions CI workflow | Nothing has gated a merge on tests passing until now — every regression to date has been caught by a human remembering to run `npm test` | `.github/workflows/ci.yml`: a Postgres 16 + pgvector service container, `npm ci` + `npx prisma migrate deploy` + `npm test` for the backend, `npm ci` + `tsc --noEmit` + `next build` for the frontend, running on every PR and push to the working branch |
| `k6` (or `autocannon`) load-test scripts | No load-testing tool exists in the repo today; a load test needs one that can express "N concurrent virtual users hitting Ask for 60 seconds" as a checked-in script, not an ad hoc curl loop | `k6` scripts (plain JS, no new language toolchain) checked into `backend/loadtest/`, run manually against a staging-like environment (not part of the PR-gating CI — a full load-test run doesn't belong on every commit) |
| `axe-core` + Lighthouse CI | No accessibility or performance tooling exists in either `package.json` today | `@axe-core/playwright` for a scripted a11y sweep of key routes (reusing the same Playwright/Chromium setup already available in this environment for E2E verification), `@lhci/cli` with a budget config gating on performance/accessibility/best-practices scores in CI |

## 5. Backend plan

### 5.1 Schema additions

```prisma
-- Not a Prisma-model change — a raw migration adding indexes Prisma's schema.prisma annotates
-- but doesn't fully control the tuning parameters of:
CREATE INDEX memory_embedding_idx ON "Memory" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX message_chunk_embedding_idx ON "MessageChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX file_chunk_embedding_idx ON "FileChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

`lists = 100` is a documented starting point (pgvector's own guidance: `rows / 1000` for up to
~1M rows), explicitly flagged for re-tuning once real row counts exist — the same "first calibrated
guess, not a settled constant" posture this codebase has applied to every other threshold since
Phase 2's duplicate-detection cutoff.

### 5.2 Services

- **`ops/health.service.ts`** (new, thin)
  - `syncFailureRate(windowHours)`: `Conversation.count({ status: 'error', lastSyncedAt: { gte } })`
    over total synced in the window — read by a monitoring endpoint, not a new metrics pipeline.
  - `embeddingBacklog()`: oldest `Memory`/`Message` row with `embedding IS NULL` /
    `graphProcessedAt IS NULL` older than a threshold — surfaces a stuck fire-and-forget chain
    before a user notices missing search results.
  - `llmErrorRate(windowHours)`: parses recent pino log output for the already-logged
    `'... call failed'` error lines each provider emits today (`llm.provider.ts`'s multiple
    `logger.error({ status: res.status }, '... call failed')` sites) — reusing existing log
    statements as the data source, not instrumenting new counters.
- **`GET /api/ops/health`** — an internal, ops-only endpoint (not customer-facing, gated by a
  separate ops API key or IP allowlist, not `requirePlan`) exposing the three metrics above for a
  monitoring dashboard or alert poller to read.

### 5.3 Endpoints

| Method | Path | Auth requirement | Maps to |
|---|---|---|---|
| GET | `/api/ops/health` | ops-only (separate from customer auth) | monitoring/alerting NFR |

No customer-facing endpoints change this phase — the work is infrastructure, indexing, tooling, and
one internal health surface.

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. A load-test run against `POST /api/ask` at a documented concurrency (e.g. 20 virtual users,
   60 seconds) meets a stated p95 latency budget — the number itself is this phase's deliverable to
   set, not assumed in advance; the test proves whatever budget gets documented is actually met.
2. The same load profile against `GET /api/context/preview` meets its own budget — proven
   separately from Ask, since the two paths have different cost profiles (Ask fans out across three
   sources; preview is single-source).
3. `EXPLAIN ANALYZE` on the retrieval query before and after the `ivfflat` index confirms an index
   scan replaces the sequential scan at a seeded row count large enough to make the difference
   observable (a few thousand rows, not the tiny counts every functional test seeds).
4. `ops/health.service.ts`'s `syncFailureRate()` correctly reports a non-zero rate when a seeded
   test forces a conversation into `status: 'error'`, and zero when none are.
5. A restored database (from a `pg_dump` taken mid-test-run) passes a subset of the existing
   integration suite unmodified — the concrete proof a backup is actually restorable, not just
   that the dump file exists.
6. The CI workflow itself is the test: a PR with a deliberately broken test fails the workflow;
   a PR with everything passing succeeds — proven by actually opening one against the working
   branch during this phase's delivery, not asserted.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

Documented load-test results within target latency/error budgets; a successful backup-restore
drill on record.

---

## 6. Frontend plan

### 6.1 Where this lives

No new routes — this phase touches existing screens (image rendering, keyboard/focus order,
responsive breakpoints) and adds process (CI, Lighthouse budgets), not new product surface.

### 6.2 Screens & components

- **Image optimization**: `memory-row.tsx` and `memories/[id]/page.tsx`'s `<img>` tags become
  `next/image`, sized appropriately (the row thumbnail and the detail-view hero image already have
  fixed/max dimensions in their current classes — `next/image`'s `width`/`height` props map
  directly).
- **Accessibility fixes**: whatever `axe-core`'s sweep surfaces across dashboard, memories,
  buckets, chat history, files, Ask, intelligence, settings/billing, and the public pricing/login
  pages — contrast, missing labels, focus traps, heading order. The knowledge graph explorer
  (`graph-explorer.tsx`) already has `role="img"`/`aria-label` on its SVG and keyboard handlers on
  its nodes (Phase 9); this phase verifies that pattern actually passes an automated check rather
  than trusting it was built correctly.
- **Onboarding tour**: a lightweight first-run overlay on `/dashboard` for a brand-new account
  (zero memories, zero buckets beyond the default) pointing at the memory capture entry point, Ask,
  and Settings — dismissible, shown once (a `hasSeenTour` flag on `Account`, the same
  minimal-schema-footprint style every prior phase's small additive flags have used).
- **Mobile-web fixes**: whatever the iOS Safari / Android Chrome smoke pass finds in the dashboard
  shell's sidebar/nav collapse behavior at narrow viewports — this phase's mobile scope is fixing
  what's found, not a mobile redesign.

### 6.3 Data fetching

No new query/mutation shapes — this phase is fixes and tooling, not new data.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

Green accessibility/perf budgets in CI; onboarding completes end-to-end on desktop and mobile web.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3 … Phase 11 §7) — only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Diagnosing latency under load | `diagnosing-bugs` | A load test that fails a budget needs a real diagnosis loop (is it the DB query, the LLM call, the connection pool ceiling?) rather than guessing at a fix — this phase is the first to generate performance regressions as its own test output |
| Index/query tuning | `prisma-postgres`, `prisma-client-api` | Choosing `ivfflat` parameters and confirming `EXPLAIN ANALYZE` actually shows an index scan is exactly this skill's territory — getting it wrong (an index that's never used because the query shape doesn't match) would ship a no-op |
| CI authoring | `nodejs-backend-patterns` | The GitHub Actions workflow is new infrastructure this codebase hasn't had — service containers, migration-before-test ordering, and caching `node_modules` correctly are the concrete details that make a first CI pipeline reliable rather than flaky |
| Accessibility | `web-design-guidelines` | The whole app gets its first systematic accessibility pass here — this skill's guidance on focus order, contrast, and ARIA labeling is the checklist `axe-core`'s findings get triaged against |
| Test-first | `tdd` | "The restored backup actually passes the test suite" and "the CI workflow actually fails on a broken PR" are claims that must be *demonstrated*, not asserted — this phase is unusually prone to "looks done" states that aren't (a backup script that was never actually restored, a CI file that was never actually triggered) |
| Final adversarial pass | `security-review` | The `/api/ops/health` endpoint is new attack surface (internal metrics about failure rates and backlogs are useful reconnaissance if exposed) — worth one more security pass before this phase, and the whole platform, is called launch-ready |

## 8. Delivery order (suggested)

1. **Backend infra:** GitHub Actions CI workflow (so every subsequent change in this phase is
   itself checked by it)
2. **Backend:** pgvector index migration, `EXPLAIN ANALYZE` verification at a realistic seeded
   row count
3. **Backend:** `k6` load-test scripts against Ask and retrieval, documented latency budgets,
   iterate on connection-pool sizing if the first run misses budget
4. **Backend:** `ops/health.service.ts` + `/api/ops/health`, tests first
5. **Backend:** backup/DR drill, executed once for real, documented
6. **Frontend:** `next/image` adoption, `axe-core` sweep + fixes, Lighthouse CI budget
7. **Frontend:** onboarding tour, mobile-web smoke pass + fixes
8. **Both:** manually verify the three browser-extension site adapters against live authenticated
   sessions (closing the flag already sitting in `chatgpt.ts`'s own comment); Firefox/Safari
   dashboard smoke pass
9. **Both:** write the staged-rollout plan document; final `security-review` and `code-review`
   passes; confirm both exit criteria are demonstrated with evidence on record, not just "should be
   fine now"

## 9. Alignment with prior phases

- **This phase changes no product behavior.** Every prior phase's endpoints, schemas, and UI stay
  exactly as they are — this phase makes them provably fast, accessible, recoverable, and
  continuously checked, not different.
- **Builds on Phase 1's logging, not around it.** `ops/health.service.ts` reads existing pino
  output and existing status columns (`Conversation.status`, `Memory.embedding IS NULL`) rather
  than introducing a parallel metrics system every future phase would then have to remember to
  also update.
- **Resolves a flag Phase 8 already raised.** The browser-extension site-adapter verification gap
  (§2, §8 step 8) has been sitting in the codebase's own comments since Phase 8 shipped — this is
  the first phase whose scope explicitly includes closing it, rather than it staying an
  indefinitely-deferred TODO.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Dashboard TTI / Ask retrieval p95 latency budget, load-tested (NFR: Performance) | §5.2/§5.4 `k6` load tests |
| Vector store scaling path decided (NFR: Scalability) | §4 pgvector index tuning + documented migration trigger |
| Async job observability: status, retry, dead-letter (NFR: Observability) | §5.2 `ops/health.service.ts` |
| WCAG 2.1 AA on all core flows (NFR: Accessibility) | §6.2 `axe-core` sweep + fixes |
| Mobile-web responsive support (`Frontend_Plan.md`) | §6.2 mobile-web pass |
| Cross-browser/extension compatibility | §8 step 8 |

## 11. Definition of done

- [ ] CI workflow runs on every PR and actually fails on a broken change (proven, not assumed)
- [ ] pgvector indexes added and confirmed in use via `EXPLAIN ANALYZE` at realistic row counts
- [ ] Documented load-test results for Ask and retrieval, within a stated latency/error budget,
      committed to the repo (not just run once and discarded)
- [ ] A backup taken and restored for real, verified against a subset of the test suite, documented
      as a runbook
- [ ] `axe-core` and Lighthouse CI both green against the budget configured in this phase
- [ ] All three browser-extension site adapters manually verified against live, authenticated
      sessions — the `chatgpt.ts` comment's flag explicitly resolved, not left open
- [ ] Mobile-web smoke pass completed on iOS Safari and Android Chrome with findings fixed
- [ ] Staged rollout plan document written and reviewed
- [ ] Final `security-review` pass covers the new `/api/ops/health` endpoint specifically
