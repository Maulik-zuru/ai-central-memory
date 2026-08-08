# Phase 9 Implementation Plan — Advanced Intelligence (Pro tier)

**Source documents:** `Product_Requirements.md` §7.8 (`US-ADV-01`–`03`), `Backend_Plan.md` Phase 9,
`Frontend_Plan.md` Phase 9
**Companion document:** `Phase10_Implementation_Plan.md` — this phase builds two brand-new
Pro-exclusive features and gates them itself at build time (§4), rather than shipping open and
waiting for Phase 10 the way Phase 3/5 did. Phase 10's `requirePlan()` middleware, once it exists,
subsumes this phase's inline checks — see §9 for the exact handoff.
**Resolves an open question:** `Frontend_Plan.md` §8 flags "knowledge graph visualization at scale
needs a rendering strategy decision (canvas/WebGL vs. SVG) before Phase 9 starts." §6.2 decides
this rather than carrying it forward as unresolved.

---

## 1. Objective

> The graph for a test account correctly links a project memory to a client bucket and a related
> past conversation, each edge traceable to its source (backend exit criteria). A Pro user can
> explore how "Project X" connects to "Client A" and "TypeScript" as a graph, and see a monthly
> usage/insights digest (frontend exit criteria).

The first phase whose entire premise is Pro-only, higher-order value on top of data every prior
phase already collected — nothing here ingests anything new, it makes connections in what's
already there.

## 2. What already exists vs. what's net-new

| Capability | Status |
|---|---|
| `Subscription.plan` field | **Exists** (Phase 1) — `"core"` \| `"pro"`, exactly what this phase's gating checks against |
| `historyLimitService`'s plan-check shape | **Exists** (Phase 5) — `subscription.plan === 'pro'` bypasses a limit; this phase's own gate (§4) copies this exact shape rather than inventing a new one |
| `LlmProvider` extension pattern | **Exists** (Phase 2/5/6) — `embed`/`suggestCategoryLabel`/`summarize`/`rerank`/`answerWithContext` all live on one interface; this phase adds `extractEntities()` the same way |
| `JobRunner` scheduled-job seam | **Exists** (Phase 5) — this phase's usage-analytics rollup and its own monthly-insight read path reuse it, not a second scheduler |
| `MonthlyInsight` (Phase 5) | **Exists** — `US-ADV-03`'s "monthly insights surfaced through a dedicated read endpoint here" means a thin read endpoint in this phase's module, not a rebuild of Phase 5's generation logic |
| Real token-savings numbers (Phase 4's `actualTokens`/`everythingTokens`) | **Exist** — `US-ADV-03`'s "tokens saved" metric is computed from these real per-preview numbers, not a separately estimated figure |
| A graph data model | **Net-new** — nothing before this phase has needed nodes/edges; `Bucket.parentId`'s self-relation (Phase 3) is a tree, not a graph, and doesn't generalize |
| Entity resolution across mentions | **Net-new** — categorization's (Phase 4) centroid-matching solves "is this memory about the same topic as that one," a different problem from "is 'the client' in memory A and 'Client A' in memory B the same named entity" |
| An event-log + rollup analytics pipeline | **Net-new** — Phase 5's `MonthlyInsight` rolls up *conversations*, not arbitrary product-usage events |

## 3. In scope / out of scope

**In scope**
- **Knowledge graph extraction**: entity/relationship extraction over memories and imported
  conversation messages → `KnowledgeGraphNode`/`KnowledgeGraphEdge`, every edge carrying a
  `sourceRef` back to the originating memory or message (`US-ADV-02`)
- **Graph read endpoint**: paginated/scoped node+edge fetch for the explorer UI, bucket-scoped
  like everything else
- **Usage analytics pipeline**: event ingestion at the points those events actually happen
  (memory created, Ask query run, sync completed, Smart Memory preview run) + scheduled
  aggregation into a fast-to-read rollup (`US-ADV-03`)
- **Monthly insights read endpoint**: exposes Phase 5's existing `MonthlyInsight` rows through
  this phase's module (not regenerated here)
- Frontend: knowledge graph explorer (interactive, click-to-source), usage analytics dashboard,
  monthly insights digest view (reusing Phase 5's summary components, per `Frontend_Plan.md` §9)
- **Pro-gating at build time** for both new features (§4) — this phase does not ship them open

**Explicitly out of scope this phase**
- **Retroactively gating Phase 3/4/5's already-shipped-open Pro features** (shared buckets beyond
  a cap, full category tuning, summaries/insights/history-limit-bypass) — that's Phase 10's
  `requirePlan()` rollout, tracked there, not duplicated here. This phase only gates what *it*
  ships.
- **Real-time graph updates** (a node appearing the instant a memory is saved) — extraction runs
  as a scheduled batch job (§4), same "not a real job queue yet" call every prior phase's
  fire-and-forget/scheduled work has made. A user sees new connections after the next run, not
  instantly — stated as a real limitation, not hidden behind a spinner that never resolves.
- **Cross-user or cross-account graph data** — the graph is strictly per-user (or per-bucket where
  scoped), never inferring relationships across different users' data even if a bucket is shared
  (a shared bucket's graph shows what's *in* that bucket, not one member's private graph merged
  with the sharer's).
- **Canvas/WebGL rendering** — §6.2 explicitly picks SVG for this phase's actual scale target ("a
  few hundred nodes," per the PRD's own AC), with the WebGL path named as the fast-follow trigger
  if usage ever demands it, not built speculatively now.

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| `LlmProvider.extractEntities()` | Entity/relationship extraction needs a model call distinct from summarization/reranking | `extractEntities(text: string): Promise<{ entities: { name: string; type: string }[]; relations: { from: string; to: string; label: string }[] }>` — extends the one interface every real-provider swap already goes through, stub path deterministic (proper-noun-ish capitalized-word heuristic + "mentioned together in the same text" as the relation), same "good enough to exercise the contract, not shippable as real NLP" bar `suggestCategoryLabel`'s stub set |
| Entity resolution | The same named thing mentioned across many memories/messages must become one node, not N duplicates | Exact-match on `(userId, normalizedName, type)` after lowercasing + trimming — deliberately simpler than Phase 4's embedding-centroid approach, because entity names are short, low-cardinality-per-user strings where exact/near-exact matching is the right first bar (a `unique` constraint the same way `Category`'s `(userId, label)` already works), not a vector similarity problem. Fuzzy resolution (typos, "Client A" vs "ClientA") is a documented gap, same posture as every other "first calibrated guess" in this codebase |
| Graph-extraction batch job | Entity extraction over every memory/message is compute-heavy and Pro-only — not a per-save fire-and-forget append like Phase 2/4's chain | Registered on `JobRunner` (Phase 5's seam, not a second one), processes `Memory`/`Message` rows where `graphProcessedAt IS NULL` for Pro-plan users only, in bounded batches, setting `graphProcessedAt` per row so a re-run doesn't reprocess (idempotency discipline this codebase applies everywhere data ingestion happens — see Phase 5's `Conversation.syncCursor`) |
| Usage-event ingestion + rollup | Reading raw events on every dashboard load doesn't scale past a trivial account age | `UsageAnalyticsEvent` (append-only, cheap to write) + a `JobRunner`-scheduled daily rollup into `UsageAnalyticsSummary` (Phase 5's `MonthlyInsight` rollup shape, generalized to more metric types) — the dashboard reads the summary table, never scans raw events |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model KnowledgeGraphNode {
  id             String                @id @default(cuid())
  userId         String
  user           User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  normalizedName String                // lowercased/trimmed — the actual dedupe key
  type           String                // "person" | "project" | "client" | "technology" | "topic" | ...
  createdAt      DateTime              @default(now())
  edgesFrom      KnowledgeGraphEdge[]  @relation("EdgeFrom")
  edgesTo        KnowledgeGraphEdge[]  @relation("EdgeTo")

  @@unique([userId, normalizedName, type])
  @@index([userId])
}

model KnowledgeGraphEdge {
  id         String             @id @default(cuid())
  userId     String
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  fromNodeId String
  fromNode   KnowledgeGraphNode @relation("EdgeFrom", fields: [fromNodeId], references: [id], onDelete: Cascade)
  toNodeId   String
  toNode     KnowledgeGraphNode @relation("EdgeTo", fields: [toNodeId], references: [id], onDelete: Cascade)
  label      String             // e.g. "works on", "mentioned with"
  // Attribution (US-ADV-02's AC: every edge traceable to a source) — exactly one of these is set.
  sourceMemoryId String?
  sourceMessageId String?
  createdAt  DateTime           @default(now())

  @@index([userId])
  @@index([fromNodeId])
  @@index([toNodeId])
}
```

`Memory` gains `graphProcessedAt DateTime?` (nullable — same lifecycle marker shape as
`embedding`/`categoryId`); `Message` (Phase 5) gains the same column.

```prisma
model UsageAnalyticsEvent {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String   // "memory_created" | "ask_query" | "sync_completed" | "context_preview"
  metadata  Json?    // e.g. { tokensSaved: 340 } for a context_preview event
  createdAt DateTime @default(now())

  @@index([userId, type, createdAt])
}

model UsageAnalyticsSummary {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  period        String   // "2026-07" (monthly) — daily granularity is a future refinement, not this phase's bar
  memoriesCreated Int    @default(0)
  askQueries    Int      @default(0)
  syncsCompleted Int     @default(0)
  tokensSaved   Int      @default(0)
  computedAt    DateTime @default(now())

  @@unique([userId, period])
}
```

### 5.2 Services

- **`graph.service.ts`**
  - `extractForMemory(memoryId)` / `extractForMessage(messageId)`: calls
    `LlmProvider.extractEntities()` on the content, resolves each entity to a node via
    `findOrCreate` (same P2002-retry-on-race pattern `categorization.service.ts` established for
    concurrent creates under the unique constraint — this job processes in bounded batches, so the
    same race class applies), creates edges between every pair of entities extracted together,
    each edge's `sourceMemoryId`/`sourceMessageId` set to the originating row. Marks
    `graphProcessedAt`.
  - `runBatch(limit)`: the `JobRunner`-scheduled entry point — selects unprocessed rows *for
    Pro-plan users only* (this phase's own inline plan check, §4/§9), processes up to `limit`,
    registered via `getJobRunner().schedule('knowledge-graph-extraction', ...)` alongside Phase
    5's monthly-insights job.
  - `getGraph(userId, opts: { bucketId? })`: returns nodes + edges scoped to the user (or further
    filtered to entities whose source memory/message is in the given bucket) — bucket-scoped
    exactly like every other read in this codebase, reusing `requireBucketMembership`/
    `accessibleBucketIds` when `bucketId` is given.

- **`analytics.service.ts`**
  - `record(userId, type, metadata?)`: a one-line fire-and-forget insert, called from the existing
    action sites (`memory.service.create()`, `ask.service.ask()`, `sync.service.processConversation()`
    on completion, `retrieval.service.buildContext()` with `metadata: { tokensSaved:
    everythingTokens - actualTokens }`) — each call site adds one line, not a rearchitecture.
  - `rollupForUser(userId, period)`: aggregates `UsageAnalyticsEvent` rows for the period into
    `UsageAnalyticsSummary` (upsert, same shape as `insight.service.ts`'s `generateForUser`).
  - `runMonthlyRollup()`: `JobRunner`-scheduled, mirrors `insightService.runForAllUsers()`.
  - `getUsage(userId, period?)`: reads the summary table — never scans raw events on the request
    path.

- **`insight.controller.ts`** (thin, in this module) — `GET /api/intelligence/insights` reuses
  `insightService`'s existing read (Phase 5), exposed here per `US-ADV-03`'s "surfaced through a
  dedicated read endpoint here."

### 5.3 Endpoints

| Method | Path | Auth requirement | Maps to |
|---|---|---|---|
| GET | `/api/intelligence/graph` (`?bucketId?`) | Pro plan (§4 inline check) | `US-ADV-02` |
| GET | `/api/intelligence/usage` (`?period?`) | Pro plan | `US-ADV-03` |
| GET | `/api/intelligence/insights` (`?month?`) | Pro plan | `US-ADV-03` (Phase 5 reuse) |

A Core-plan caller gets `403 PRO_FEATURE` with an upgrade-path message (`US-BIL-04`'s AC, honored
here even though Phase 10 hasn't shipped yet — see §9).

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. A memory mentioning two entities together produces a node for each and one edge between them,
   with `sourceMemoryId` set to that memory — the central attribution test `US-ADV-02` exists to
   make pass.
2. The same entity mentioned across two different memories resolves to one node, not two — mirrors
   Phase 4's categorization-stability test shape, applied to entity resolution.
3. Every edge returned by `getGraph()` has exactly one of `sourceMemoryId`/`sourceMessageId` set —
   no unattributed edges ever leave the service layer.
4. A Core-plan user gets `403 PRO_FEATURE` from all three endpoints in §5.3; a Pro-plan user
   succeeds.
5. `analytics.service.record()` calls at each real action site produce events whose aggregated
   `rollupForUser()` output matches a hand-computed expectation for a scripted sequence of actions
   — `US-ADV-03`'s "metrics match what actually happened" AC, made concrete.
6. `tokensSaved` in a rollup equals the sum of real `everythingTokens - actualTokens` values from
   actual preview calls in the period, never an estimated constant.
7. A bucket-scoped graph request never includes nodes whose only source is a memory outside that
   bucket — same scope-exclusivity proof every phase since Phase 3 has required.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

The graph for a test account correctly links a project memory to a client bucket and a related
past conversation, each edge traceable to its source.

---

## 6. Frontend plan

### 6.1 Where this lives

New `/dashboard/intelligence` (or nested under Settings — placement decision: a top-level nav
item, since this is a Pro-exclusive feature area distinct from Settings' account-management
framing, matching how Ask and Files each got their own top-level surface).

### 6.2 Screens & components

- **Knowledge graph explorer** — **SVG-rendered** (resolving `Frontend_Plan.md` §8's open
  question): the PRD's own AC caps the target at "a few hundred nodes... not a frozen unreadable
  mass," which is comfortably within SVG + a force-directed layout's practical range (a few
  thousand DOM nodes before frame drops become noticeable) without a WebGL/canvas library's added
  complexity and worse accessibility (SVG nodes are real DOM elements — focusable, screen-reader
  labelable, unlike canvas pixels). Documented as the explicit fast-follow trigger: if real usage
  ever produces graphs in the thousands of nodes, that's when a canvas/WebGL rewrite is justified,
  not before. Click a node → side panel showing its source memory/conversation
  (`Frontend_Plan.md`'s "click a node to see source").
- **Usage analytics dashboard** — a handful of stat cards (memories created, tokens saved, Ask
  usage, sync volume) for a selectable time range, each number sourced directly from
  `UsageAnalyticsSummary` — no placeholder/estimated figures rendered as if exact (`US-ADV-03`'s AC).
- **Monthly insights digest** — reuses Phase 5's summary-rendering component verbatim
  (`Frontend_Plan.md` §9's explicit instruction), not a new digest UI.
- **Locked-state card** — for a Core-plan viewer landing on this section: the same
  upgrade-path-shown pattern `US-BIL-04` requires, previewed here ahead of Phase 10's full
  pricing/checkout flow (a static "Upgrade to Pro" card linking to Settings, not a working
  checkout yet — that's Phase 10).

### 6.3 Data fetching

- `useKnowledgeGraph({ bucketId })`, `useUsageSummary({ period })`, `useMonthlyInsight({ month })`
  — plain queries, same shape as every other read-only dashboard panel.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A Pro user can explore how "Project X" connects to "Client A" and "TypeScript" as a graph, and see
a monthly usage/insights digest.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3 … Phase 8 §7) — only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| New provider method | `codebase-design` | `extractEntities()` extends the one `LlmProvider` interface again — the fifth method added to it since Phase 2, proof the seam scales rather than needing per-feature bespoke clients |
| Graph/entity modeling | `domain-modeling` | "What makes two entity mentions the same node" and "can an edge exist without a source" have to be answered before `KnowledgeGraphNode`/`Edge` are schema — the exact-match dedupe strategy (§4) is a real modeling decision with a documented fallback gap (fuzzy matching), not an afterthought |
| Raw SQL / batch idempotency | `prisma-client-api`, `nodejs-backend-patterns` | The extraction batch job's `graphProcessedAt` marker and the P2002-retry-on-race pattern are the same idempotent-ingestion discipline Phase 5's sync cursor and Phase 4's categorization lock established — reused, not reinvented a third time |
| Test-first | `tdd` | Entity-resolution stability and edge-attribution completeness are exactly the "looks right, silently wrong" surface this discipline targets |
| Rendering-strategy decision | `vercel-react-best-practices` | Resolving SVG-vs-canvas against the PRD's actual stated scale (§6.2) rather than guessing "big graphs need WebGL" — matching the tool to the real requirement |
| Accessibility of a graph UI | `web-design-guidelines` | Nodes as real, focusable DOM elements (an SVG-specific win called out in §6.2) needs keyboard navigation and labels verified before calling the explorer done — a canvas graph would have failed this by construction |
| Visual consistency | `frontend-design` | Stat cards, the locked-state upgrade card, and the graph explorer are three new shapes that must read as the same notebook-identity product, not a new "Pro dashboard" brand |

## 8. Delivery order (suggested)

1. **Backend infra:** `LlmProvider.extractEntities()`; `Memory.graphProcessedAt`/`Message.graphProcessedAt`
   + `KnowledgeGraphNode`/`Edge` schema migration
2. **Backend:** `graph.service`'s extraction + resolution, tests first (entity-resolution
   stability, edge-attribution completeness)
3. **Backend:** `graph.service.getGraph()` bucket-scoped read, tests first (scope-exclusivity)
4. **Backend:** `UsageAnalyticsEvent`/`Summary` schema; `analytics.service.record()` wired into the
   four real action sites; `rollupForUser()`, tests first (metrics-match-reality)
5. **Backend:** endpoints + inline Pro-plan gate, tests first (403 for Core, success for Pro); full
   Phase 1–8 regression suite green
6. **Frontend:** stat cards + monthly insights digest (reusing Phase 5 components)
7. **Frontend:** SVG knowledge graph explorer with click-to-source panel
8. **Both:** `code-review` and `web-design-guidelines` pass; confirm exit criteria with a real
   multi-memory, multi-conversation seeded account, not a two-node synthetic graph

## 9. Alignment with Phase 10

- **This phase's inline Pro-plan checks are a stopgap, explicitly.** `graph.service.runBatch()`
  and the three endpoints in §5.3 each do their own `subscription.plan === 'pro'` check (the exact
  shape `historyLimitService` already established). Once Phase 10 ships `requirePlan('pro')` as
  route middleware, these three endpoints should adopt it and the inline checks should be deleted
  — not left as a second, divergent gating mechanism running alongside the real one.
- **Phase 10's `requirePlan()` retrofit list should include this phase's two features from day
  one** — not discovered later. This phase's own gates are correct on day one; the risk Phase 10
  actually owns is the *other*, already-shipped-open Pro features from Phase 3/5 (see
  `Phase10_Implementation_Plan.md` §3's retrofit table).
- **`UsageAnalyticsEvent` is a natural home for billing-relevant metering too** — Phase 10's usage
  metering (conversation count, sync limits) could read from this same event log rather than
  each phase maintaining its own counter, though `historyLimitService`'s direct
  `prisma.conversation.count()` is simpler and already correct for that one case — Phase 10 should
  decide per-metric whether the event log or a direct count is the right source, not default to
  one for everything.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Knowledge graph explorer (`US-ADV-02`) | §5.2 `graph.service`, §6.2 SVG explorer |
| Usage analytics dashboard (`US-ADV-03`) | §5.2 `analytics.service`, §6.2 stat cards |
| Monthly insights read endpoint (`US-ADV-03`) | §5.3 `/api/intelligence/insights` reusing Phase 5 |

## 11. Definition of done

- [ ] All Phase 9 endpoints in §5.3 implemented and covered by tests written per §5.4
- [ ] Phase 1–8's existing test suite still passes unmodified
- [ ] Backend exit criteria (§5.5) demonstrated with a real multi-memory, multi-conversation
      seeded Pro account, with attribution manually spot-checked on a handful of edges
- [ ] Frontend exit criteria (§6.4) demonstrated live: explore a real graph, click a node, land on
      its source; view a real monthly digest
- [ ] `code-review` and `web-design-guidelines` run against this document and the PRD as spec
- [ ] The SVG-vs-canvas decision (§6.2) is revisited only if real usage data shows graphs
      regularly exceeding a few hundred nodes — not preemptively "upgraded" to canvas out of
      caution
- [ ] §9's Phase 10 handoff (inline checks → `requirePlan()`) is tracked as a concrete Phase 10
      task, not left implicit
