# MemoryPlugin Parity — Implementation Plan (Phases 14–23)

**Date:** 2026-08-10
**Branch:** `claude/memory-plugin-implementation-plan`

**Source documents (read in full before starting any phase below):**
- `docs/MemoryPlugin_Clone_Spec.md` — the target architecture, data model, integration mechanisms, API surface, and non-functional principles
- `docs/MemoryPlugin_Clone_Spec_Confirmation_Report.md` — the checklist-style scorecard this plan closes out (4 Built / 9 Partial / 12 Not built)
- `docs/MemoryPlugin_Deep_Analysis_Final_Report.md` — the mechanism-level "why" behind every gap, including the ranked plan this document expands into full phases
- `docs/MemoryPlugin_Gap_Analysis.md` and `docs/Requirements_Conformance_Report.md` — the two earlier, less-precise audits; where they disagree with the three documents above, the more technically precise spec wins (already noted inline in the deep-analysis report §6)
- `docs/adr/0001`–`0005` — five architectural decisions this plan depends on; each phase below cites the ADR it implements rather than re-arguing the decision
- `docs/Product_Requirements.md`, `docs/Backend_Plan.md`, `docs/Frontend_Plan.md` — the original PRD and phase plans, still the source of truth for anything this document doesn't touch
- `docs/Phase1_Implementation_Plan.md` through `docs/Phase13_DesktopAgent_Implementation_Plan.md` — this plan continues that numbering and that template; skim at least Phase 8 (browser extension) and Phase 13 (desktop agent) before starting Phases 22–23, since both are extended here rather than rebuilt from scratch

---

## 0. How this plan is organized

Ten phases, numbered 14–23, continuing directly from the repo's existing Phase 1–13 sequence. The
order is **not** the confirmation report's phase numbering (which mirrors the spec's own §9) — it's
re-sequenced by the deep-analysis report's §7 ranked plan: cheapest-and-highest-leverage first
(closing small known gaps, then the two integration surfaces that unlock the most new capability per
unit of work — public API and MCP), then the deepest architectural rebuild (recall pipeline,
reliability), then the remaining feature-parity work in roughly the spec's own priority order.

Each phase below gives: objective, what's reused vs. net-new, in/out of scope, the concrete backend
and frontend steps, which skills apply and why, a suggested delivery order, exit criteria, and a
traceability line back to the specific `US-*` story or confirmation-report finding it closes. This
mirrors the template every existing `PhaseN_Implementation_Plan.md` uses — condensed here because ten
phases in one document need to stay readable, not because any phase is less real than the ones already
shipped.

**Definition of done for this whole plan:** every ❌/🟡 row in
`MemoryPlugin_Clone_Spec_Confirmation_Report.md` §2–8 has a phase number next to it below, and every
phase's own exit criteria are demonstrated against a real seeded account before that phase is called
done — not against a plan document saying it's done. That discipline is what the two prior conformance
reports were for; this plan should not create a third round of "Met" verdicts nobody re-checked.

---

## Phase 14 — Foundation fixes and quick wins

### 1. Objective
Close every small, already-precisely-scoped gap from the two prior conformance reports before
starting any of the larger rebuilds — none of these require new architecture, and leaving them open
while building Phases 15–23 on top just compounds the number of things to remember to fix later.

### 2. Scope

| Item | Fix | Source |
|---|---|---|
| Bucket delete refuses instead of asking | Add `strategy: 'move-to-default' \| 'delete-contents'` param to `DELETE /api/buckets/:id`; radio choice in the dialog | Gap Analysis §1 |
| Extension onboarding walkthrough | Build the walkthrough; make something read `onboardingPending` (`background/index.ts:83`); add a replay entry in Settings | Gap Analysis §1 |
| Memory list / transcript viewer don't paginate | Wire `useInfiniteQuery` in `dashboard/memories/page.tsx` and `dashboard/chat-history/[id]/page.tsx` against the cursors the API already returns | Gap Analysis §1 |
| Export has no completion notification | One `emailProvider.send()` call at the end of `export.service.ts`'s completion path | Gap Analysis §1 |
| Ask mode not locked per thread | Reject/ignore a `mode` argument differing from the thread's first message once `AskConversation` has ≥1 message | Deep Analysis §2.10 (Gap Analysis correction) |
| History cap is global, not per-platform | Add `platform` to `history-limit.service.ts:20`'s `where` clause and to `import.service.ts:76`'s call signature | Deep Analysis §2.4 |
| Image memories: permanent URL, no shared-bucket guard | Add 4-hour signed-URL expiry (see Phase 23 for the full delivery-pattern rebuild — this item is just the shared-bucket guard: block `contentType: 'image'` when `bucket.sharedWith.length > 0`) | Gap Analysis §2.9 |
| `merge()` has no `merged_into` trail | Add a `mergedIntoId` pointer on the absorbed memory instead of losing its identity entirely | Deep Analysis §5 |

### 3. Out of scope
The full image-memory signed-URL delivery pattern (Phase 23), the at-rest-encryption claim
(infrastructure-gated, tracked in `Requirements_Conformance_Report.md` §7 item 4 — no code fix exists
until real infra is stood up), and the async-job retry/dead-letter NFR (also infra-gated, same report).

### 4. Skills used

| Area | Skill | Why |
|---|---|---|
| Bucket delete strategy, mode lock, history cap | `nodejs-backend-patterns`, `prisma-client-api` | Small, well-bounded service/query changes with no new abstraction needed |
| Every fix in this phase | `tdd` | Each is a single acceptance clause from an existing story — write the failing test from the AC first, exactly as the prior audits already worded it |
| Pagination UI | `vercel-react-best-practices` | `useInfiniteQuery` against an existing cursor API is the textbook case this skill's data-fetching guidance covers |

### 5. Delivery order
1. Backend: bucket-delete strategy param, history-cap platform scoping, Ask mode lock, `mergedIntoId` — tests first for each, since each is one AC.
2. Backend: export completion email via existing `EmailProvider`.
3. Backend: image shared-bucket guard on `createImage`.
4. Frontend: infinite-scroll on memories list and transcript viewer.
5. Extension: onboarding walkthrough + Settings replay entry.
6. Full regression suite green; manual spot-check of each fix against a seeded account.

### 6. Exit criteria / Definition of done
- [ ] All eight rows in §2 demonstrated fixed against a real seeded account, not just unit-tested in isolation
- [ ] Phase 1–13 test suite passes unmodified
- [ ] `US-ORG-01`, `US-ACC-05`, `US-ASK-02`, `US-ARC-08`, `US-MEM-09`, `US-ARC-04`, `US-INT-01` move from Partial/Not-built to Met in the next conformance pass

---

## Phase 15 — Public REST API v2 + OpenAPI spec

### 1. Objective
Publish a documented, versioned REST API matching the shapes in `MemoryPlugin_Clone_Spec.md` §6
closely enough that it's genuinely usable by n8n/Zapier/Postman/custom code — and, just as important,
close enough that the OpenAPI file it produces can be imported directly as a ChatGPT GPT Action in
Phase 23 with no separate schema-writing effort. This is the single highest-leverage phase in the
whole plan per the deep-analysis report §2.7: it's mostly *exposing* logic that already exists, not
building new logic.

### 2. What's reused vs. net-new

| Capability | Reused | Net-new |
|---|---|---|
| Single memory CRUD | `memory.service.ts` create/list/get/update/delete, unchanged | Versioned route surface (`/api/v2/...`), response shape aligned to spec (`memoryId`/`dbId` alias, `content_type` field) |
| Bucket CRUD | `bucket.service.ts`, unchanged | — |
| Bulk memory operations | — | `POST /api/v2/memory/update` (bulk move, ≤100, all-or-nothing with `rejectedIds`), `POST /api/memories/bulk-delete` (reports `deleted`/`failed` counts) |
| Chat-history programmatic ingest | `import.service.ts`'s upsert-on-`(bucketId,platform,externalId)` logic, generalized | `POST /api/chat-history/ingest/custom-online` — JSON body path (not just file upload), 100k-token/50MB caps |
| Conversation delete | — | `DELETE /api/chat-history/chats` (net-new — no conversation delete exists today at all) |
| OpenAPI spec | — | Generated from the same Zod schemas already validating every route (`zod-to-openapi` or equivalent), published at a stable path |

### 3. In scope / out of scope
**In scope:** the 15 endpoints in the spec's §6 table, an OpenAPI 3.x document generated from source
(not hand-maintained separately — it will drift immediately if it is), and every existing endpoint not
in that table marked `internal: true` in the same spec so `US-INT-06`'s "every endpoint is either
documented publicly or explicitly marked internal" AC is actually satisfiable.
**Out of scope:** GraphQL, gRPC, or any transport beyond REST; rate limiting beyond what already
exists (a separate, already-tracked NFR item).

### 4. Backend plan
- Version the memory/bucket route surface; keep the existing unversioned paths working as aliases
  during a deprecation window rather than breaking any current caller (dashboard, extension) on day one.
- Bulk move: single Prisma transaction, validate every ID belongs to the caller before writing any of
  them, return `rejectedIds` for anything that doesn't resolve — genuinely all-or-nothing, not
  best-effort.
- Bulk delete: same ownership check, per-ID try/catch so one bad ID doesn't abort the batch, report
  `{ deleted: number, failed: string[] }`.
- `ingest/custom-online`: reuse `import.service.ts`'s dedup key logic against a JSON body instead of a
  parsed file; return `{ status: 'queued' }` immediately, process async — this is also the endpoint
  Phase 22's extension-driven sync (§Phase 22) will eventually call, so its upsert contract needs to be
  correct here, not patched later.
- Conversation delete: irreversible, no soft-delete — pair with Phase 22's Exclude operation, which
  *is* soft (keeps a placeholder); the two need to stay clearly distinct per `MemoryPlugin_Clone_Spec.md`
  §3.3, not collapsed into one "delete."
- OpenAPI generation: wire directly off the Zod schemas already in `*.types.ts` files across every
  module — one source of truth, generated at build time, served at a fixed path.

### 5. Skills used

| Area | Skill | Why |
|---|---|---|
| Route/schema design | `codebase-design`, `nodejs-backend-patterns` | Versioning without breaking existing callers, and a bulk-write endpoint that's genuinely all-or-nothing, are exactly the "deepen the interface, don't just add a flag" and "idempotent batch write" patterns these skills target |
| Prisma transactions for bulk ops | `prisma-client-api` | All-or-nothing bulk move needs a single transaction with pre-validated IDs, not per-row writes with manual rollback |
| Test-first on every new endpoint | `tdd` | Bulk all-or-nothing behavior and upsert idempotency are exactly the "looks right, silently wrong under a partial failure" surface this discipline targets |
| API documentation | `writing-for-agents` | The OpenAPI descriptions are read by an LLM (a GPT Action, an MCP client) at least as often as by a human — write them for that audience |

### 6. Delivery order
1. Backend: versioned route surface + response-shape alignment, tests first.
2. Backend: bulk move/delete endpoints, tests first (all-or-nothing, partial-failure reporting).
3. Backend: `ingest/custom-online` JSON path, tests first (upsert idempotency, size/token caps).
4. Backend: conversation delete, tests first (irreversibility, distinct from Phase 22's Exclude).
5. Backend: OpenAPI generation off existing Zod schemas; mark every non-listed route `internal`.
6. Deprecation-window plan for the old unversioned paths, documented, not silently dropped.

### 7. Exit criteria / Definition of done
- [ ] All 15 spec'd endpoints exist with matching (or documented-deviation) shapes
- [ ] OpenAPI file is generated, not hand-written, and validates against the OpenAPI 3.x schema
- [ ] `US-INT-06` closed: every endpoint is either in the published spec or marked internal
- [ ] Full regression suite green; existing dashboard/extension callers unaffected during the
      deprecation window

---

## Phase 16 — MCP server (local + remote)

### 1. Objective
Ship both MCP tiers the spec describes — local (`npx`, stdio, static token) and remote/hosted
(HTTP, OAuth 2.0 + PKCE + Dynamic Client Registration) — exposing the 13 named tools. Per the
deep-analysis report §2.2, 10 of 13 tools are mostly wiring over logic Phase 15 (or earlier phases)
already expose; 3 need genuinely new service code.

### 2. What's reused vs. net-new

| Tool | Backing logic |
|---|---|
| `store_memory` | `memory.service.ts:45` `create()` |
| `get_memories_and_buckets` | `memory.service.ts:103` `list()` + `bucket.service.ts:87` `list()` |
| `search_memories` | `retrieval.service.ts:88` `buildContext()` |
| `list_buckets` / `create_bucket` | `bucket.service.ts` `list()`/`create()` |
| `update_or_move_memories` | Phase 15's bulk move endpoint — **built there, wrapped here** |
| `list_bucket_categories` | `category.service.ts:8` `list()` — needs bucket-scoping + a summary field, which lands with Phase 20's Smart Memory rebuild; ship a reduced version here, upgrade in Phase 20 |
| `list_category_memories` | **Net-new** — filter memories by `categoryId`, straightforward once Phase 20's category model exists |
| `recall_chat_history` | `ask.service.ts` + Phase 17's rebuilt recall pipeline — ship against the Phase-14-era pipeline first, upgrade automatically once Phase 17 lands underneath it |
| `get_conversation_summary` / `get_full_conversation` | `conversation.service.ts:41` + `summary.service.ts:8` |
| `export_conversation` | **Net-new** — a per-conversation, 15-minute-TTL signed download link; adjacent to but distinct from the whole-account export in `export.service.ts` |
| `search_uploaded_files` | `file-search.service.ts:70` `search()` |

### 3. In scope / out of scope
**In scope:** both transports, all 13 tools (even where a tool ships in a reduced form pending a later
phase, per the table above — a present-but-limited tool beats an absent one), OAuth 2.0 + PKCE + DCR
for the remote tier, a local `@<product>/mcp-server` npm package for the local tier.
**Out of scope:** an `mcp-remote` local-proxy fallback for clients with no native remote-MCP support —
useful, but the spec itself frames it as a compatibility shim for older clients, not core scope.

### 4. Backend plan (applying the `mcp-builder` skill's checklist directly)
- **Transport:** Streamable HTTP for the remote server (the current MCP spec's recommended transport;
  the skill's own best-practices guide flags SSE as deprecated in its favor — implement the spec's SSE
  endpoint only as a compatibility alias, not the primary path). stdio for the local server, logging to
  stderr only, never stdout.
- **Tool naming:** the spec's own names (`store_memory`, etc.) are kept for user-facing familiarity, but
  every tool is registered with an internal namespace prefix so this server composes cleanly alongside
  other MCP servers a client might have connected — resolve the exact prefix against this product's own
  name at implementation time, not `memoryplugin`.
- **Schemas:** Zod input schemas per tool, reusing the same schemas Phase 15's REST routes already
  validate against — one schema, two transports, not two independently-drifting definitions.
- **Annotations:** every tool gets `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` —
  concretely: `search_memories`/`get_memories_and_buckets`/`list_*`/`get_conversation_summary`/
  `get_full_conversation`/`search_uploaded_files` are `readOnlyHint: true`; `store_memory` and
  `create_bucket` are `idempotentHint: false`; `update_or_move_memories` is the one genuinely
  `destructiveHint: true` tool (it can move memories out of buckets the caller loses access to).
- **Pagination:** `get_memories_and_buckets`, `search_memories`, `list_category_memories`, and
  `recall_chat_history` all return `has_more`/`next_offset`/`total_count`, defaulting to 20–50 items,
  per the skill's pagination guidance — never load an unbounded result set into one tool response.
- **Auth:** local tier validates the static token on server startup with a clear failure message if
  missing/invalid; remote tier implements OAuth 2.0 + PKCE + DCR per the MCP spec, validates the
  `Origin` header, and — since this is a hosted HTTP server, not a local one — does not need the
  127.0.0.1-binding/DNS-rebinding mitigation that applies to *locally-run* HTTP servers specifically.
- **Errors:** tool-level errors (`isError: true` in the result, not a protocol-level failure) with
  actionable text — e.g. an unresolved bucket ID names the problem and suggests calling `list_buckets`
  first, per the skill's example pattern — and never leak internal stack traces.
- **Evaluation:** once built, write the skill's recommended 10 realistic, read-only, independently
  verifiable evaluation questions (e.g. "which bucket has the most memories," "what did I say about X
  last month") and confirm an actual MCP client (Claude Code, Cursor) answers all 10 correctly before
  calling this phase done — this is a real test of whether the tool descriptions are good enough for a
  model to use unprompted, not just whether the endpoints return 200.

### 5. Skills used

| Area | Skill | Why |
|---|---|---|
| Whole phase | `mcp-builder` | This phase *is* the skill's subject matter — tool design, transport selection, annotations, pagination, error handling, and the evaluation methodology all come directly from it, not improvised |
| Auth split (static token vs. OAuth+PKCE+DCR) | `codebase-design` | Two genuinely different trust models behind one tool surface is a real interface-design decision, not a config flag — worth treating with the same rigor as any other seam |
| stdio/HTTP server implementation | `nodejs-backend-patterns` | Process lifecycle, stderr-only logging, and graceful shutdown for a long-running local process are exactly this skill's territory |
| Test-first on every tool | `tdd` | A tool that silently returns wrong data to a model is worse than one that errors clearly — write the "does this tool call return what the description promises" test before the handler |

### 6. Delivery order
1. Local MCP server package: stdio transport, static-token auth, the 10 tools with existing backing
   logic wired directly, tests via MCP Inspector.
2. The 3 net-new pieces: `list_category_memories` (reduced), `export_conversation`,
   `update_or_move_memories` (depends on Phase 15).
3. Remote MCP server: Streamable HTTP transport, OAuth 2.0 + PKCE + DCR, same 13 tools reused from
   step 1–2 behind a different auth middleware.
4. Annotations + pagination pass across all 13 tools per the skill's checklist.
5. 10 evaluation questions, run against a real MCP client, fix whatever they surface.

### 7. Exit criteria / Definition of done
- [ ] Local server installable via `npx`, connects from Claude Code/Cursor with a pasted token
- [ ] Remote server reachable via OAuth+PKCE+DCR with zero config-file secret
- [ ] All 13 tools present with correct annotations and pagination
- [ ] `US-INT-03` (split into `US-INT-03a` local / `US-INT-03b` remote per Gap Analysis §2.6) closed
- [ ] 10/10 evaluation questions answered correctly by a real client

---

## Phase 17 — Chat-history recall pipeline rebuild

### 1. Objective
Rebuild chat-history recall to the spec's six-stage pipeline (`MemoryPlugin_Clone_Spec.md` §5.4),
stage by stage, each independently shippable and testable — this is the single largest architecture
gap found in the deep-analysis report (§3: 0 of 5 Phase-3 checklist items built) and the phase the
spec itself calls "where most of the real engineering effort goes."

### 2. Scope, one stage at a time

| Stage | Today | Target |
|---|---|---|
| 1. Query expansion | Single literal query embedded once | LLM rewrites into first-person "what I probably said" variants + extracts a date filter; original query always kept in the variant set |
| 2. Hybrid search + fusion | pgvector cosine only | Add a BM25/keyword index alongside the existing vector index; fuse per-variant dense + keyword result lists via **Reciprocal Rank Fusion** (`sum(1/(k+rank+1))`, k≈60) — never a weighted sum of raw scores, per `MemoryPlugin_Clone_Spec.md` §7.3 |
| 3. Rerank | Single LLM-prompted reorder (`precise` mode) | A dedicated reranking step fed ≥100 candidates from stage 2, not a handful — keep the LLM-prompted approach if a dedicated cross-encoder model isn't available yet, but feed it the *fused* pool, not a raw top-K |
| 4. Per-chunk relevance assessment | Static distance-threshold filter (`RELEVANCE_DISTANCE_CEILING`) | An LLM judges each surviving candidate: does it actually answer the query, not just resemble it — expect this to dominate latency, per the spec, and budget for it explicitly |
| 5. Context expansion | Single best-matching chunk only (`DISTINCT ON (c.id)`) | Pull `position-1`/`position+1` neighboring messages around each surviving hit |
| 6. Budgeted, cited summarization | Raw truncated string preview, no LLM, no citations | Read-time AI summary within a token budget (600 default/2,000 cap for an inject-style path, ~2,000 for raw synthesis) with citations (conversation id/title, message id, date, score) — implements ADR-0005; for conversations too large for one pass, a map-reduce fold, not one giant context call |

### 3. In scope / out of scope
**In scope:** all six stages, for both the REST `search`/`inject`-equivalent endpoints (Phase 15) and
the MCP `recall_chat_history` tool (Phase 16) — one pipeline, multiple callers.
**Out of scope:** migrating the vector store off pgvector. The spec's own reference stack uses
Zilliz/Milvus for native BM25-alongside-vectors, but `Backend_Plan.md`'s own scaling note already
flags "pgvector → dedicated vector DB" as a decision to make once data volume demands it — this phase
should get hybrid search working *within* pgvector (a separate `tsvector`/GIN index for BM25-equivalent
keyword scoring, fused by RRF against the existing pgvector cosine results) rather than forcing a
vector-store migration as a prerequisite.

### 4. Backend plan
- Add a `tsvector` column + GIN index on `MessageChunk` for keyword search alongside the existing
  vector index — this is the pragmatic "hybrid within pgvector" path, not a new datastore.
- Implement RRF as a pure function over two ranked ID lists (dense, keyword) per query variant, then
  fuse again across variants by each document's *best* rank across all variants — not first-list-wins.
- `LlmProvider` gains `expandQuery()`, `assessChunkRelevance()`, and a query-shaped
  `summarizeWithCitations()` method — following the same "extend the one provider interface" pattern
  `codebase-design` already established for `extractEntities()` (Phase 9) and `rerank()` (existing).
- Chunking: move from character-based `MAX_CHUNK_CHARS=1000` to a token-based ~256-token chunk with
  light overlap — this changes the shape of `MessageChunk` generation in `sync.service.ts`, so plan a
  re-chunk migration for already-imported conversations, not just new ones going forward.
- Fail-open/fail-silent fix rides along here since it's the same code path: every provider call in
  this pipeline must distinguish "provider call failed" (throw / explicit error surfaced to the
  caller) from "genuinely no relevant results" (empty list) — see Phase 18 for the fuller sweep, but
  don't introduce new instances of the anti-pattern while building six new provider-calling stages.

### 5. Skills used

| Area | Skill | Why |
|---|---|---|
| RRF / hybrid search implementation | `codebase-design`, `nodejs-backend-patterns` | Fusing two ranked lists correctly (by rank, never raw score) is exactly the kind of "get the seam right once" work this skill pushes toward, since every future retrieval feature will call the same fusion function |
| Chunking migration | `prisma-client-api` | Re-chunking existing `MessageChunk` rows safely (idempotent, resumable, no duplicate chunks) needs the same batch-migration discipline Phase 5's sync cursor already established |
| Test-first per stage | `tdd` | Each of the six stages has an independently testable, falsifiable claim ("RRF fusion order is scale-invariant to a 100x score-magnitude difference between retrievers" is a real, automatable test) |
| Read-time summarization design | `domain-modeling` (ADR-0005 already recorded) | The write-time-vs-read-time trade-off is a genuine architectural decision, already captured — this phase implements it, doesn't re-decide it |

### 6. Delivery order
1. Stage 2 first (hybrid + RRF) — the spec's own "single most consequential implementation detail,"
   and the one that changes the shape of every result downstream of it.
2. Stage 5 (context expansion) — small, independent, immediately improves answer quality.
3. Stage 4 (per-chunk relevance) — needs stage 2's larger candidate pool to have something to filter.
4. Stage 3 (rerank) — needs stage 2's fused pool as its input.
5. Stage 1 (query expansion) — layered on top since it multiplies the work of stages 2–4 per variant;
   sequencing it last means stages 2–4 are proven correct against a single query before adding
   variant-fan-out complexity.
6. Stage 6 (budgeted, cited summarization) — the final assembly step, naturally last.
7. Chunking migration, run once, dry-run against a copy first.

### 7. Exit criteria / Definition of done
- [ ] All six stages implemented and independently tested
- [ ] A precision-sensitive query (`US-ARC-07`) demonstrably surfaces the right result where the old
      single-pass cosine search did not, on a real seeded multi-conversation account
- [ ] `US-ASK-03`'s "every non-trivial claim traceable to a shown source" now includes message-level
      citations, not just conversation-level
- [ ] Recall latency measured end-to-end against the spec's ~2-second target and the budget documented
      even if not yet fully met
- [ ] Confirmation report's Phase 3 row moves from 0/5 to 5/5

---

## Phase 18 — Reliability and non-functional architecture fixes

### 1. Objective
Close the five architecture-principle gaps the deep-analysis report §4 found, independent of any
single feature — these are cross-cutting correctness properties that make every other phase's work
more trustworthy once fixed, and riskier to keep building on top of the longer they stay open.

### 2. Scope

| Principle | Fix |
|---|---|
| Write path blocking the response path | `capture.service.ts:23-24`'s `await provider.extractMemoryCandidates(...)` inside `submit()` moves to fire-and-forget, matching every other write path in the codebase; the extension gets an immediate ack and the suggestion appears once extraction completes |
| Fail-open, never fail-silent | Every provider method that currently catches-and-substitutes (`llm.provider.ts:373-380,415-421,218-221`) instead throws a typed, retryable error; callers (`retrieval.service.ts`, `chat-search.service.ts`, Phase 17's new stages) catch that error explicitly and surface a "couldn't check memory right now" state distinct from "no relevant memory found" |
| Layered duplicate matching | `duplicate-detection.service.ts` gains an exact-string-match tier (cheapest, checked first) and a deterministic fuzzy tier (trigram/`pg_trgm`) before falling back to the existing embedding-threshold check for the genuinely ambiguous remainder |
| Context placement ("lost in the middle") | `retrieval.service.ts`'s final context-assembly step reorders the already-scored list so the strongest items sit at the start *and* end of the injected block, not in pure score-descending order |
| Version vs. overwrite, replaces vs. extends | Implements ADR-0003's `supersedes` relation — `stale-detection.service.ts` classifies a flagged pair as `replaces`/`extends` before creating a suggestion |

### 3. In scope / out of scope
**In scope:** the five items above, applied wherever they currently occur in the codebase (not just in
new code going forward). **Out of scope:** introducing a real job queue (BullMQ/Redis) to replace the
in-process `job-runner.provider.ts` — that's the Phase-0 infrastructure gap already tracked in
`Requirements_Conformance_Report.md` §5, and fail-open/fail-silent correctness doesn't require a queue,
just correct error propagation within the current in-process model.

### 4. Backend plan
- Define one typed `ProviderError` (or similar) that every `LlmProvider`/embedding-provider method
  throws on genuine failure, distinct from returning an empty/fallback result on genuine "nothing here."
- Audit every call site catching a provider call today (`retrieval.service.ts`, `chat-search.service.ts`,
  `embedding.service.ts`, and Phase 17's six new stages) to handle the distinction explicitly — this is
  a sweep across existing code, not just a new convention for new code.
- `pg_trgm` extension + a similarity index for the fuzzy-match tier; exact-match tier is a plain
  case-insensitive equality check, no index needed beyond what already exists.
- Placement: after scoring/sorting, interleave into `[strongest, ..., 3rd-strongest, 2nd-strongest]`
  ordering (strongest at both edges) rather than monotonic descending — a small, mechanical change to
  the final assembly step in `retrieval.service.ts`.

### 5. Skills used

| Area | Skill | Why |
|---|---|---|
| Error-propagation sweep | `codebase-design` | A typed error crossing one interface (`LlmProvider`) cleanly, rather than each call site inventing its own catch behavior, is exactly the "one seam, used consistently" principle |
| Fuzzy-match tier | `prisma-client-api` | `pg_trgm` similarity queries via Prisma raw SQL, same discipline as the existing pgvector raw queries in `chat-search.service.ts` |
| Test-first | `tdd` | "A provider outage produces a distinguishable error, not an empty result" is a concrete, mockable, automatable test — write it before changing the catch blocks |

### 6. Delivery order
1. `ProviderError` type + throw-instead-of-substitute change across all `LlmProvider` methods, tests
   first (mock a provider failure, assert the caller sees an error, not an empty list).
2. Sweep every call site to handle the new error type explicitly.
3. Capture-path fire-and-forget change, tests first (response time no longer includes extraction).
4. Layered duplicate matching, tests first (exact match short-circuits before any embedding call).
5. Context placement reordering, tests first (assert edge positions, not just "same set of items").
6. `supersedes` relation + `replaces`/`extends` classification (implements ADR-0003).

### 7. Exit criteria / Definition of done
- [ ] A simulated provider outage produces a clear, distinguishable error at every call site, verified
      by test — not a silently-empty "no memories found"
- [ ] Capture endpoint response time no longer includes the extraction LLM call
- [ ] Exact-duplicate memories are caught without an embedding call; the embedding tier only runs on
      genuinely ambiguous pairs
- [ ] A seeded context-assembly test confirms edge placement, not just item selection
- [ ] `MemoryPlugin_Deep_Analysis_Final_Report.md` §4's five verdicts all move to "Matches"

---

## Phase 19 — Memory Suggestions curator rebuild

### 1. Objective
Implement ADR-0004: unify duplicate-detection and stale-detection into one Memory Suggestions curator
with three operation types (Remove/Combine/Update), N-way combine, a real content-rewriting Update,
the 10,000-token analysis skip, and — since this moves from direct DB comparison to an LLM proposing
memory IDs from a cluster — the mandatory ID-revalidation-against-ownership safeguard.

### 2. What's reused vs. net-new
Reused: the accept/reject-gated write discipline (`suggestion.service.ts`'s approve/dismiss flow) —
this stays exactly as strict, just operating on the new three-type taxonomy. Net-new: nearest-neighbor
clustering as the detection unit (replacing independent pairwise duplicate/stale scans), the
`combine`/`update` write paths, and the ID-revalidation check.

### 3. In/out of scope
**In scope:** the full curator rebuild per ADR-0004's consequences section. **Out of scope:** changing
which model tier runs the curator (the spec uses a cheap/fast model for this by design — matching that
choice is a provider-config decision at implementation time, not a scope item).

### 4. Backend plan
- Clustering: for each memory, pull its `k` nearest neighbors by embedding distance (a small, bounded
  set — this replaces the current full-bucket pairwise scan, which doesn't scale past a few hundred
  memories anyway).
- One LLM call per cluster, prompted with the "you are an editor, not a writer, lose zero information"
  framing from the spec, proposing exactly one of Remove/Combine/Update (or no action).
- **Mandatory re-validation**: every memory ID the model returns is checked against the actual cluster
  membership and the caller's ownership before the suggestion is even created, let alone written — this
  is the safeguard ADR-0004 calls "the only thing standing between [hallucinated IDs] and a corrupted
  store," so it belongs at suggestion-creation time, not just at approval time.
- `MemorySuggestion.type` migration: `duplicate`→`remove`, `stale`→`update` (existing `stale` rows
  can't be retroactively classified `replaces`/`extends` — default them to `update` and let Phase 18's
  new classification apply only to newly-detected pairs going forward).
- `combine` suggestions carry `memoryIds: string[]` (N-way); approving one concatenates/merges all
  named memories' content into a survivor, preserving every named preservation category from the spec
  (dates, quantities, identifiers, current state, causal "why") — this is a prompt-engineering
  requirement on the curator's own merge-proposal step, not just a data-shape change.
- `update` suggestions carry proposed new content for the target memory; approving one creates a new
  `MemoryVersion` with that content (reusing existing versioning, not a special case).
- 10,000-token skip: measure each candidate memory's token count before including it in any cluster;
  skip it from analysis entirely (it still exists normally, it's just excluded from Suggestions scans).

### 5. Skills used

| Area | Skill | Why |
|---|---|---|
| Curator design (ADR-0004) | `domain-modeling` | The decision is already recorded; this phase is the concrete follow-through the ADR's consequences section lays out |
| ID-revalidation safeguard | `codebase-design` | A single, non-bypassable validation chokepoint between "model output" and "database write" is the kind of seam worth getting right once and reusing, not re-implementing per suggestion type |
| Migration of existing suggestion rows | `prisma-client-api` | A one-time, resumable data migration mapping old types to new, same discipline as prior schema migrations in this repo |
| Test-first | `tdd` | "A hallucinated ID from the model never reaches a write" is a concrete, adversarial test to write before the write path, not after |

### 6. Delivery order
1. Schema migration: `MemorySuggestion.type` enum change + `memoryIds`/proposed-content columns, data
   migration for existing rows.
2. Backend: clustering + one-LLM-call-per-cluster detection, tests first (cluster boundaries, one
   proposal per cluster).
3. Backend: ID-revalidation chokepoint, tests first (adversarial — a fabricated ID must never reach a
   write, on any of the three operation types).
4. Backend: Combine (N-way merge with preservation categories) and Update (content-rewrite) write
   paths, tests first (no named preservation category is ever dropped).
5. Backend: 10,000-token skip.
6. Frontend: unify `DuplicateCard`/`StaleCard` into one three-type suggestion card; pending-count badge
   per bucket; "Check for new" manual scan action.

### 7. Exit criteria / Definition of done
- [ ] Remove/Combine/Update all reachable end-to-end from a real seeded bucket with genuinely
      duplicate, related, and stale memories
- [ ] Adversarial test confirms a fabricated model-returned ID is rejected before any write
- [ ] A 3-memory Combine preserves a date, a quantity, and a "since X" timestamp across the merge,
      verified by test, not just by inspection
- [ ] `US-MEM-06`/`US-MEM-07` re-scored as one closed story against the real mechanism, per Gap
      Analysis §2.2

---

## Phase 20 — Smart Memory two-tier rebuild

### 1. Objective
Replace the flat, single-pass weighted scorer in `retrieval.service.ts` with the spec's two-tier
mechanism: batch AI categorization with summary + "additional context" fields, category-summary-first
loading, on-demand full-category expansion, and the three hard gates (≥30-memory minimum, 600k-token/
2,000-memory ceiling). Depends on ADR-0002's bucket-type discriminator (Phase 14/15 timeframe — confirm
it's landed before starting the categorization-eligibility check here).

### 2. Scope
- Batch categorization job: reads every memory in one eligible bucket, clusters into a handful of named
  categories (auto-named or seeded with 2–10 user-defined names before first run) — replacing the
  current incremental per-memory centroid-matching approach.
- `Category` gains `summary` and `additionalContext` fields (the spec is explicit the latter matters
  more for recall quality than the former — write the categorization prompt accordingly).
- Retrieval path becomes two-tier: category summaries load first (cheap); a category's full memory list
  expands only when the live conversation is judged relevant to it (a marker-command-equivalent — this
  can be a tool-call-shaped signal for MCP/API callers, since we're not carrying the browser
  extension's marker-line convention forward as our primary capture mechanism per Phase 22's own scope).
- Hard gates: skip categorization entirely under 30 memories; refuse a bucket over 600,000 tokens or
  2,000 memories (surface this as a clear "too large to categorize yet" state, not a silent no-op).
- Eligibility: only the account's own memory-type buckets (ADR-0002's `type` field), never file
  buckets, never buckets merely shared *to* the user.
- Destructive reset: resetting categories detaches every memory's category assignment; require a typed
  confirmation phrase, matching the spec's own UX for this action.
- Owner-only re-run: per ADR-0001's consequence, fix `category.service.ts`'s recategorization gate from
  `editor-or-owner` to owner-only as part of this rebuild, not as a separate patch.

### 3. Skills used

| Area | Skill | Why |
|---|---|---|
| Category model shape (summary + additionalContext) | `domain-modeling` | "What does a category need to carry for an AI to decide when to expand it" is exactly the kind of fuzzy-requirement-made-precise this skill targets — the spec's own hint (additionalContext matters more than summary) is a real design signal worth encoding in the prompt, not just the schema |
| Two-tier retrieval implementation | `codebase-design` | Cheap-first, expensive-on-demand is a deepening of the existing `retrieval.service.ts` interface, not a bolt-on parameter |
| Batch job idempotency | `prisma-client-api`, `nodejs-backend-patterns` | Re-running categorization on a bucket that's already categorized needs the same idempotent-batch discipline as Phase 9's graph extraction and Phase 5's sync cursor |
| Test-first | `tdd` | The hard gates (30/600k/2,000) and the "file buckets never qualify" exclusion are exact, falsifiable acceptance criteria |

### 4. Delivery order
1. Confirm ADR-0002's `type` discriminator has landed (dependency check, not new work here).
2. Backend: batch categorization job with `summary`/`additionalContext` generation, tests first
   (clustering produces named categories, not just embeddings).
3. Backend: hard gates (30-min, 600k/2,000 ceiling), tests first.
4. Backend: two-tier retrieval path (summaries-first, on-demand full-category expansion), tests first.
5. Backend: destructive reset with confirmation-phrase requirement; owner-only re-run gate fix.
6. Frontend: category summary/additionalContext display, reset confirmation dialog, context-preview
   surface updated to show the two-tier behavior accurately (`US-ADV-01`'s existing preview AC).

### 5. Exit criteria / Definition of done
- [ ] A 100+-memory bucket categorizes into named categories with both fields populated
- [ ] A bucket under 30 memories shows an honest "not enough memories yet" state, not a silent no-op
- [ ] A 2,500-memory bucket is refused with a clear message, not attempted and timed out
- [ ] A file bucket and a bucket shared-to-the-user both correctly never appear as categorization-
      eligible
- [ ] Category reset requires the confirmation phrase and is demonstrated irreversible
- [ ] `US-ADV-01` re-scored against the real two-tier mechanism, not the old flat-scorer verdict

---

## Phase 21 — Shared buckets Contributor role + chat-history Exclude/Delete/pinning

Two independent, similarly-scoped feature additions grouped into one phase because both are
schema-plus-service-plus-frontend changes of comparable size, not because they're related.

### 1. Objective, part A — Contributor role (implements ADR-0001)
Add the `contributor` tier, enforce creator-scoped edit rights for it specifically, and fix the
categorization owner-only gate (the latter is also listed in Phase 20 — do it in whichever phase lands
first; don't do it twice).

### 2. Objective, part B — Chat-history Exclude/Delete/pinning
Implement the three-way distinction `MemoryPlugin_Clone_Spec.md` §3.3 describes: **Exclude** (wipes
content+vectors, keeps a placeholder, never re-imported), **Delete** (removes now, Phase 15 already
built this as irreversible-removal — clarify it can reappear on a future sync/import, matching the
spec), and **pinning** (protects a conversation from any future bulk operation).

### 3. Backend plan — Part A
- `ROLE_RANK` gains `contributor` between `viewer` (0) and `editor` (2) → renumber to `{viewer:0,
  contributor:1, editor:2, owner:3}`.
- `requireAccess()` in `memory.service.ts` adds a caller-vs-`memory.userId` check specifically for the
  `contributor` role — every other role's behavior is unchanged.
- Frontend invite dialog (`manage-members-dialog.tsx`) gains the third option; **Contributor becomes
  the default** selected role on a fresh invite, matching the spec.

### 4. Backend plan — Part B
- `Conversation` gains `excludedAt: DateTime?` and `pinned: Boolean` fields.
- Exclude: deletes `MessageChunk` rows + their vectors, keeps the `Conversation` row as a placeholder
  with `excludedAt` set; the sync/import upsert logic (Phase 15's `ingest/custom-online`, the existing
  file import) checks `excludedAt` and skips re-creating an excluded conversation's content.
- Delete: hard-removes the `Conversation` and its messages; no placeholder — a future sync/import can
  recreate it, which is the documented, intentional difference from Exclude.
- Pinning: a bulk-delete request rejects any pinned ID in the batch rather than silently skipping it,
  with a clear per-ID reason in the response.

### 5. Skills used

| Area | Skill | Why |
|---|---|---|
| Contributor role (ADR-0001) | `domain-modeling` | Already recorded; this is the follow-through |
| Permission-check audit | `codebase-design` | Every existing call site touching `ROLE_RANK` needs re-auditing once a fourth rank is inserted — a seam-consistency check, not a one-line diff |
| Exclude/Delete/pin schema | `prisma-client-api` | Straightforward additive fields, but the upsert-skip-on-`excludedAt` logic needs the same care as any idempotency check elsewhere in this codebase |
| Test-first | `tdd` | "A contributor can edit their own memory but gets a 403 on someone else's" and "an excluded conversation never reappears on re-sync" are both precise, adversarial tests |

### 6. Delivery order
1. Schema migrations for both parts (independent, can run in either order).
2. Backend: Contributor role enforcement + owner-only categorization fix, tests first.
3. Backend: Exclude (with upsert-skip integration into Phase 15's ingest endpoint and the existing file
   importer), tests first.
4. Backend: pinning + bulk-delete rejection, tests first.
5. Frontend: three-role invite selector (Contributor default), Exclude action distinct from Delete in
   the chat-history UI, pin toggle.

### 7. Exit criteria / Definition of done
- [ ] A Contributor can add and edit their own memories, gets a 403 on another member's, in a real
      seeded shared bucket
- [ ] Categorization re-run is owner-only, verified by test
- [ ] An excluded conversation never reappears after a subsequent sync/import of the same source;
      a deleted one can
- [ ] A pinned conversation survives a bulk-delete call that targets it alongside non-pinned ones
- [ ] `US-ORG-04` re-scored against the three-role model; `MemoryPlugin_Clone_Spec.md` §3.3's three
      chat-history operations all exist and are distinct

---

## Phase 22 — Browser extension: marker-line capture path + platform breadth

### 1. Objective
This is the phase most directly about "how it's connected with different AIs." Add the marker-line
capture mechanism (`MemoryPlugin_Clone_Spec.md` §4.1) as a **second, complementary** capture path
alongside the existing DOM-scraping adapters — not a replacement, since DOM-scraping already works for
the three platforms it covers and ripping it out would regress those. Then extend platform breadth
using whichever mechanism fits each new target.

### 2. Why marker-line as an addition, not a replacement
DOM-scraping and marker-line have complementary failure modes (deep-analysis report §2.1): DOM-scraping
breaks silently on redesigns and can never let the model *decide* something is worth remembering, only
observe what rendered. Marker-line requires no per-site selector maintenance and enables AI-proactive
capture, but depends on the model following an injected instruction. Running both means: existing
platforms keep working through their DOM adapter, and any *new* platform can be added via marker-line
alone (no adapter-writing needed) — which is exactly how this phase reaches breadth faster than writing
21 more adapters would.

### 3. Scope
- **Injected instruction, tested for refusal behavior first** — per the spec's explicit warning, write
  the exact composer-injected text as annotation-shaped, first-person ("[note to self: ...]"), no
  ceremony, and test it against real model responses on at least two platforms before shipping; a
  directive-shaped payload ("The user has enabled...") is a known failure mode, not a style preference.
- Marker detection: watch the streamed/rendered response for `to=<product>&&memory=[text]` (or the
  product's own equivalent convention — not literally `memoryplugin`), extract, route through the
  existing suggestion-review pipeline unchanged (no new capture semantics, matching Phase 13's own
  stated discipline for the desktop agent).
- Text-selection pill: lower the threshold from 8 characters to match the spec's ≥3, and rename to
  match whatever this product calls the action.
- Auto-inject countdown: add a 5-second cancellable countdown as an alternative to today's fully-manual
  click-to-inject, defaulting to manual until the countdown UX is verified not to surprise users.
- Panel UI: restructure from the current 2-tab (Memories/Settings) popup to the spec's shape — floating
  draggable button with remembered per-site position, header with branding/plan-badge/dark-mode toggle,
  bucket-selector + Smart Mode row, bottom tab bar (Memories/Sync/History/Account/Settings) — the
  "Sync"/"History" tabs are new surface area enabled by this same phase's chat-history integration
  (next bullet).
- Chat-history capture: route new-conversation detection through Phase 15's `ingest/custom-online`
  endpoint (not `/api/capture`) — this is the piece that makes `US-ARC-02`'s "automatic sync" claim
  true for the first time, per Gap Analysis §2.5's finding that no path existed anywhere for this.
- Platform breadth: add adapters/marker-line support for the next-highest-traffic targets after
  ChatGPT/Claude/Gemini — prioritize by the spec's own compatibility matrix, marker-line-only for
  platforms where a DOM adapter isn't already justified by traffic.

### 4. Skills used

| Area | Skill | Why |
|---|---|---|
| Injection payload wording | `writing-for-agents` | The injected text's entire audience is a model, not a human — testing it for refusal behavior is the same discipline as writing any other agent-facing instruction, just adversarially, since a wrong wording actively fails |
| Panel UI rebuild | `frontend-design`, `web-design-guidelines` | A 5-tab restructure with a draggable, position-persisted button touches layout, accessibility (focus management on drag), and the extension's visual identity all at once |
| Marker detection / streaming-response watching | `nodejs-backend-patterns` (client-side equivalent patterns apply) | Watching a stream for a pattern and intercepting it before render is a parsing/state-machine problem worth designing deliberately, not ad-hoc string matching sprinkled through the content script |
| Test-first, both mechanisms | `tdd` | "The exact injected wording doesn't get refused by the target model" is testable today by actually sending it; write that test before expanding to more platforms |

### 5. Delivery order
1. Draft and test the injected marker-instruction wording against real ChatGPT/Claude/Gemini sessions
   — fix wording before writing any detection code, since a refused instruction makes the rest of this
   phase moot.
2. Marker detection + routing through the existing suggestion pipeline, as an addition alongside the
   current DOM adapters (both active simultaneously on the three existing platforms — compare which
   one actually captures more/better in practice before deciding whether to keep both indefinitely).
3. Chat-history capture path into `ingest/custom-online`.
4. Text-selection threshold change; auto-inject countdown (behind a setting, default off until
   verified).
5. Panel UI restructure (5-tab shape).
6. Platform breadth: 2–3 new targets via marker-line-only, prioritized by traffic.

### 6. Exit criteria / Definition of done
- [ ] Injected instruction verified not to trigger refusal on at least 2 real platforms, documented
- [ ] Marker-line capture works end-to-end into the existing review pipeline, alongside (not replacing)
      DOM adapters
- [ ] New conversations sync automatically into chat history via the extension — `US-ARC-02`'s
      "automatic" half, closed for the first time
- [ ] Panel UI matches the 5-tab shape; draggable button position persists per-site
- [ ] At least 2 new platforms reachable via marker-line with no DOM adapter written

---

## Phase 23 — Remaining integration breadth: Custom GPT / TypingMind / desktop completion / image URLs / graph

The last phase bundles the spec's own Phase 5 ("breadth and polish") items that don't need their own
dedicated phase — each is small relative to Phases 15–22, and grouping them avoids a plan with twenty
phases for work that doesn't warrant it.

### 1. Custom GPT / GPT Actions
Import Phase 15's OpenAPI spec as a GPT Action; write the system-instruction block per
`MemoryPlugin_Clone_Spec.md` §4.3 (bucket semantics, ID-hallucination guardrails, quick-save shortcut
convention) — treat the instruction block as a first-class, versioned artifact, not throwaway setup
copy, per the spec's own framing of why it matters.

### 2. TypingMind plugin
A native plugin exposing the same function surface as Phase 16's MCP tools, pasted-token auth instead
of OAuth — mostly a thin adapter over logic Phase 16 already built.

### 3. Desktop agent completion
Wire the two stubbed sources (`cursorSource`, `codexSource` in `desktop/src/main/sources/`) to real
paths (`~/.cursor/projects`, `~/.codex/sessions`); add a named, user-visible **Focused sync** setting
to `AgentConfig` that explicitly constrains the parser to prompts + final answers only — making today's
incidental exclusion of tool-call content into an enforced, auditable policy instead of a side effect
of the current parser's behavior (deep-analysis report §2.5's exact finding).

### 4. Image memory signed-URL delivery pattern
Replace the permanent static `imageUrl` with a 4-hour-expiring signed URL, keeping the non-expiring
`imageDescription` as the field every text-based recall path actually uses day to day — the shared-
bucket guard shipped already in Phase 14; this closes the rest of `US-MEM-05`'s gap.

### 5. Knowledge graph merge-review step
Add a separate LLM review/merge pass between entity extraction and the existing deterministic
name-based dedup, using a distinctly stronger model for that one step specifically — matching the
spec's "reserved for a step nothing downstream double-checks" rationale (`MemoryPlugin_Clone_Spec.md`
§5.3). Keep the existing hourly-batch scheduling and the graph's deliberate exclusion from retrieval —
neither of those needs to change.

### 6. Skills used

| Area | Skill | Why |
|---|---|---|
| GPT Action instruction block | `writing-for-agents` | The instruction block's entire job is shaping a model's behavior correctly — same discipline as Phase 22's injected marker text, applied to a system-instructions context instead of a composer-injection context |
| TypingMind plugin | `codebase-design` | A thin adapter over Phase 16's tool logic is the payoff of having built that logic behind one clean service interface in the first place |
| Desktop Focused-sync setting | `codebase-design`, `domain-modeling` | Turning an incidental parsing behavior into a named, enforced policy is exactly "make the implicit explicit" — worth a short glossary entry in a future `CONTEXT.md` if one gets started for this repo |
| Signed URL delivery | `nodejs-backend-patterns` | Standard signed-URL-with-TTL pattern; the interesting part is making sure every caller (dashboard, MCP's future image support, API) reads `imageDescription` as the durable field and treats the URL as disposable |
| Graph merge-review model selection | `domain-modeling` | Choosing to spend more on one specific step because nothing downstream catches its mistakes is a real, recordable trade-off if it doesn't already read as obvious from the code |

### 7. Delivery order
1. Desktop agent folder wiring (independent of everything else in this phase, ship first).
2. Image signed-URL delivery pattern (independent, small).
3. Custom GPT Action + instruction block (depends on Phase 15's OpenAPI spec).
4. TypingMind plugin (depends on Phase 16's MCP tool logic).
5. Knowledge graph merge-review step (independent, lowest priority per the spec's own ranking).

### 8. Exit criteria / Definition of done
- [ ] A Custom GPT Action built from the published OpenAPI spec correctly loads memories at chat start
      and never guesses a bucket ID
- [ ] TypingMind plugin functions map 1:1 to Phase 16's MCP tools
- [ ] Cursor and Codex desktop sources read real transcripts; Focused sync is a visible, working toggle
- [ ] Image memory URLs expire at 4 hours; description never does; both verified by test
- [ ] Knowledge graph merge-review demonstrably catches at least one entity-variant case the plain
      exact-match dedup would have missed, on a real seeded bucket

---

## Appendix: traceability from confirmation-report findings to phases

| Confirmation report finding | Phase |
|---|---|
| §2 Phase 1 gaps (bucket delete, bulk ops, `merged_into`) | 14 (partial), 15 (bulk ops) |
| §3 Phase 2 gaps (MCP local+remote, marker-line, injection safety) | 16 (MCP), 22 (marker-line) |
| §4 Phase 3 gaps (hybrid+RRF, rerank, query expansion, read-time summary, fail-open) | 17, 18 |
| §5 Phase 4 gaps (Smart Memory, Memory Suggestions, chat-history sync/ingest) | 20, 19, 15+22 |
| §6 Phase 5 gaps (platform breadth, desktop, files, image URLs, sharing roles, graph) | 22, 23, (files already met), 23, 21, 23 |
| §7 Compatibility matrix (3/~30 platforms) | 22, 23 |
| §8 API surface (2/15 endpoints equivalent) | 15 |
| Deep Analysis §4 (five NFR principles) | 18 |
| Gap Analysis §1 (previously-known small gaps) | 14 |

## Document control

| Field | Value |
|---|---|
| Plan version | 1.0 |
| Date | 2026-08-10 |
| Branch | `claude/memory-plugin-implementation-plan` |
| Phases covered | 14–23 |
| Depends on | ADR-0001 through 0005 (`docs/adr/`) |
| Supersedes | The ranked plan in `MemoryPlugin_Deep_Analysis_Final_Report.md` §7 (that section's 8-item list is expanded here into the full 10-phase plan; this document is the one to execute against) |
