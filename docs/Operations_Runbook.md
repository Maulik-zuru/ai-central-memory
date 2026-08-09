# Operations Runbook

Phase 12 deliverable (`docs/Phase12_Implementation_Plan.md` §3). Covers backup/restore, the health
endpoint, load testing, browser-extension verification status, and the staged rollout plan. Everything in the Backup and Restore section
below has been executed for real against this codebase, not just written down — the recorded
results are in §1.3.

---

## 1. Backup and disaster recovery

### 1.1 Taking a backup

```bash
./backend/ops/backup.sh "postgresql://user:pass@host:5432/ai_memory" ./backups
```

Produces a compressed custom-format dump (`pg_dump -Fc`) and immediately verifies it is readable
with `pg_restore --list`. A dump that cannot be listed will not restore, and the time to discover
that is now, not during an incident.

**Cadence:** daily automated dump, retained 30 days. Object storage (uploaded files and image
memories) is backed up by the storage layer's own versioning/replication — the Postgres dump does
**not** contain file bytes, only the `storageKey` references to them. Restoring the database
without also having the object store means memories and files will exist with broken image/download
links.

### 1.2 Restoring

```bash
./backend/ops/restore.sh ./backups/memoryos-<stamp>.dump "postgresql://user:pass@host:5432/target"
```

The script creates the `vector` extension before restoring, because the dump contains
`vector(1536)`-typed columns that cannot be created without it. It uses `--clean --if-exists` so a
restore over a populated database is deterministic rather than half-merging into existing rows.

### 1.3 Restore drill — executed 2026-08-08

| Step | Result |
|---|---|
| `pg_dump` of the development database | 96 KB dump, `pg_restore --list` verified readable |
| Restore into a fresh `ai_memory_restore_drill` database | Completed with no errors |
| Row counts preserved | 18 users, 42 memories — matching source exactly |
| Embeddings preserved | 42/42 memories still had non-null `vector(1536)` embeddings |
| HNSW indexes preserved | All four (`memory`, `message_chunk`, `file_chunk`, `category`) present after restore |
| **Test suite against the restored database** | **32 tests across 5 suites passed** (`memory`, `smart-memory`, `compliance`, `ops`, `image-memory`) |

The last row is the one that matters: the restored database is not merely present, it is *correct
enough to serve the application*. A restore verified only by row counts can still be missing
extensions, indexes, or constraints.

**Known limitation, stated rather than glossed over:** this drill ran against a development-sized
database on the same host. It proves the procedure and the dump's completeness; it does not
establish a restore-time RTO for a production-sized dataset. Re-run against a production-scale
snapshot before the GA milestone in §5.

---

## 2. Health and alerting

`GET /api/ops/health`, authenticated with the `x-ops-key` header against `OPS_API_KEY`.

- With no `OPS_API_KEY` set, the endpoint **404s** — it does not exist in a default-open state, and
  local development/CI get no ops surface at all.
- A normal user session or customer API key is rejected. This is an operator surface: failure rates
  and job backlogs are reconnaissance to an attacker and useless to an end user.

```json
{
  "checkedAt": "2026-08-08T17:30:00.000Z",
  "database": "ok",
  "sync": { "windowHours": 24, "total": 120, "failed": 3, "rate": 0.025 },
  "embeddings": { "stale": 0, "oldestAgeSeconds": null }
}
```

### Alert conditions

| Condition | Meaning | Suggested threshold |
|---|---|---|
| `database != "ok"` | The process cannot reach Postgres | Page immediately |
| `sync.rate` high with `sync.total > 10` | A platform's export format likely changed and its parser is failing — the `US-ARC-01` fragility risk the PRD already flags | Warn above 0.10, page above 0.25 |
| `embeddings.stale > 0` | The fire-and-forget embedding chain died; new memories are silently missing from search | Warn above 0, page if sustained 30+ min |
| `embeddings.oldestAgeSeconds` growing | Backlog is not draining, as distinct from a one-off failure | Page above 3600 |

LLM provider error rates are already emitted as structured `logger.error` lines from
`llm.provider.ts` on every non-OK provider response; alert on their rate in the log aggregator
rather than duplicating a counter in the application.

---

## 3. Load testing

Scripts live in `backend/loadtest/`. They are deliberately **not** part of PR CI — a full run takes
minutes and would make every commit slow.

```bash
k6 run -e BASE_URL=https://staging.example.com -e TOKEN=<access-token> backend/loadtest/ask.js
k6 run -e BASE_URL=https://staging.example.com -e TOKEN=<access-token> backend/loadtest/context-preview.js
```

### Stated budgets

| Path | Profile | p95 budget | Error budget |
|---|---|---|---|
| `POST /api/ask` | 20 concurrent VUs, 60s | < 3000 ms | < 1% |
| `POST /api/context/preview` | 40 concurrent VUs, 60s | < 500 ms | < 1% |

Ask's budget is looser because it includes a real LLM round-trip that the preview path does not.
These are this phase's first stated numbers — written down so they can be argued with and re-tuned
against production telemetry, not inherited from anywhere.

**Seed the target account with a realistic corpus first.** Running either script against an empty
account measures the empty-result path and reports a flatteringly wrong number.

### Vector index status

Phase 12 added HNSW indexes on every embedding column
(`20260808180000_phase12_vector_indexes`). Measured on this codebase at 5,000 memory rows:

| | Execution time |
|---|---|
| Sequential scan (pre-index) | 38.5 ms |
| HNSW index scan | 1.3 ms |

**HNSW, not the `ivfflat` originally planned.** The reason is structural rather than a benchmark
preference: an `ivfflat` index computes its cluster centroids from the rows present at build time,
and migrations run against an empty table — so an `ivfflat` index created in a migration is built
from no data and needs a manual `REINDEX` later to be worth anything. That is a silent trap where
the index exists, queries appear to use it, and recall is quietly poor. HNSW builds incrementally
and is correct from an empty table onward.

**Migration trigger to a dedicated vector database:** revisit only when `p95` on
`context-preview` breaches its budget *with* the HNSW index in use and after `m`/`ef_construction`
tuning has been attempted — not on row count alone, and not preemptively.

### ⚠️ The vector-index trap — read before committing any generated migration

These indexes are created in raw SQL because they sit on `Unsupported("vector(1536)")` columns
Prisma's schema language cannot describe. **Prisma therefore does not know they exist and treats
them as drift.** The next migration `prisma migrate dev` generates after them will silently open
with `DROP INDEX` statements for all four.

This already happened once: `20260808173630_phase12_has_seen_tour`, a one-line migration adding a
boolean column, was generated with four `DROP INDEX` lines at the top and dropped every vector
index in the database. Nothing failed. Every query kept returning correct results — just via a
sequential scan again. It was caught in review, not by any test.

Two defences are now in place:

1. `tests/vector-index.test.ts` asserts all four indexes exist **and** are `USING hnsw` with
   `vector_cosine_ops`. CI fails if a migration removes them.
2. `20260808190000_restore_vector_indexes` recreates them idempotently (`IF NOT EXISTS`).

**When you run `prisma migrate dev`, read the generated `migration.sql` before committing it and
delete any `DROP INDEX ..._hnsw_idx` lines.**

---

## 4. Browser extension — verification status

Verified 2026-08-08 by loading the built extension into a real Chromium instance
(`--load-extension`) and driving the actual UI, not by inspection:

| Check | Result |
|---|---|
| MV3 manifest loads; background service worker registers | ✅ |
| Popup renders the unpaired "Connect your account" state | ✅ |
| Connect opens the dashboard with a pairing code | ✅ correct origin |
| Consent banner discloses scopes before granting | ✅ |
| Confirming stores the key in `chrome.storage.session` | ✅ |
| Popup transitions to the connected panel | ✅ |
| Content script mounts on a matching page, into a **closed** shadow root | ✅ host page cannot inspect it |
| Quick Inject affordance renders on the page | ✅ |
| Phase 11 consent gate honoured with the extension's own paired key | ✅ `platform=chatgpt` off → 0 suggestions; `platform=claude` on → 1 |
| Extension key blocked from `DELETE /api/account` and `POST /api/account/export` | ✅ both 403 |

**Still open (unchanged from Phase 8):** the ChatGPT/Claude/Gemini DOM selectors in
`extension/src/lib/site-adapters/` have **not** been verified against live, authenticated sessions
— no such credentials exist in this environment. The verification above used a mock page matching
the manifest's URL pattern, which proves the extension's own machinery (manifest, worker,
messaging, pairing, shadow-DOM mount, consent gate) but not that the selectors match today's real
ChatGPT/Claude/Gemini markup. Those sites ship DOM changes without notice. **This remains a
Stage 1 (internal) gate item in §5 and must be done by hand against each live product.**

Local development requires `npm run build:local` in `extension/` — the default `npm run build`
targets production origins, and a production-origin build cannot talk to a local backend.

---

## 5. Desktop agent — verification status

Verified on this machine, against a live backend (2026-08-09):

| Check | Result |
|---|---|
| Pair → device row + scoped key with no `apikey:manage` | pass |
| Key delivered once; second poll reports `expired` | pass |
| Real Claude Code JSONL parsed; planted `sk-` key stripped before queueing | pass |
| Queue drained → pending capture suggestions on the account | pass (2 suggestions) |
| Platform consent off → next capture yields 0 suggestions | pass |
| Device revoked → agent's next capture returns 401 and the uploader pauses | pass |
| Headless Electron boot; renderer sees only the preload bridge, no Node globals | pass |

**Not verified, and not claimable:**

- No signed macOS or Windows installer exists. `electron-builder.yml` and the release matrix have
  never run — signing and notarization require the respective platforms and certificates.
- The app has never run on macOS or Windows. Tray behaviour, `safeStorage` (Keychain / DPAPI), and
  the folder picker are unexercised on both.
- Cursor and Codex sources ship disabled with the reason shown in the UI; only `claude-code`
  captures anything.

### Revoking a device in an incident

`DELETE /api/desktop/devices/:id` from a logged-in session revokes the device *and* its API key in
one step. The agent stops on its next request (401), pauses itself, and stops retrying — it does
not need to be reachable for the revocation to take effect.

---

## 6. Staged rollout plan

Per-user data isolation has been enforced at the bucket-membership layer since Phase 3, so cohorts
do not need separate infrastructure — they are just accounts.

### Stage 1 — Internal (1 week)
Team accounts only. Real personal data, used daily, so the "does it hold up in normal use" question
gets an honest answer.
- **Entry:** CI green; the restore drill in §1.3 re-run against production infrastructure.
- **Exit:** no P1 defects for 3 consecutive days; `sync.rate` under 0.05; `embeddings.stale` at 0;
  **and the three site adapters verified by hand against live, authenticated ChatGPT, Claude, and
  Gemini sessions** (§4) — the one part of the extension no automated check in this repo covers.

### Stage 2 — Closed beta (2–4 weeks, 25–50 accounts)
Invited users across the three supported extension platforms, chosen to include people with large
existing ChatGPT/Claude export histories — the import path is the most fragile surface
(`US-ARC-01`) and needs real-world data volume, not synthetic.
- **Entry:** Stage 1 exit met; billing verified end-to-end with real Stripe test-mode webhooks.
- **Exit:** load-test budgets (§3) met against production-shaped data; no unresolved data-loss or
  billing-correctness defects; at least one real data-export and one real account-deletion request
  completed and verified in `ComplianceLog`.

### Stage 3 — General availability
- **Entry:** Stage 2 exit met; the `US-SEC-02` legal review of the LLM provider's data-use terms is
  **complete** — this is a hard gate, and it is not an engineering task
  (`Product_Requirements.md` §10 flags it; `NO_TRAINING_HEADERS` in `llm.provider.ts` is the
  engineering half only, and does not close it).
- **Rollback:** revert the deployment; no schema rollback is expected to be needed, as every
  Phase 1–12 migration is additive. Restore from backup (§1.2) only in a data-corruption scenario.
