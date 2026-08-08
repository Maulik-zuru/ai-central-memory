# Operations Runbook

Phase 12 deliverable (`docs/Phase12_Implementation_Plan.md` §3). Covers backup/restore, the health
endpoint, load testing, and the staged rollout plan. Everything in the Backup and Restore section
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
snapshot before the GA milestone in §4.

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

---

## 4. Staged rollout plan

Per-user data isolation has been enforced at the bucket-membership layer since Phase 3, so cohorts
do not need separate infrastructure — they are just accounts.

### Stage 1 — Internal (1 week)
Team accounts only. Real personal data, used daily, so the "does it hold up in normal use" question
gets an honest answer.
- **Entry:** CI green; the restore drill in §1.3 re-run against production infrastructure.
- **Exit:** no P1 defects for 3 consecutive days; `sync.rate` under 0.05; `embeddings.stale` at 0.

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
