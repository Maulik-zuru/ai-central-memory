# Phase 5 Implementation Plan — Chat History Archive (Import + Sync)

**Source documents:** `Product_Requirements.md` §7.4 (`US-ARC-01`–`08`), `Backend_Plan.md` Phase 5,
`Frontend_Plan.md` Phase 5
**Companion document:** `Phase6_Implementation_Plan.md` — both phases add a new first-class data
store alongside Memories, both reuse Phase 3's bucket/RBAC model instead of inventing scoping
rules, and both feed Phase 7's "Ask" query router as parallel retrieval sources. Where a decision
in one phase constrains the other (chunking shape, citation format, provider seams), it's called
out explicitly in both docs rather than left to be discovered mid-build, the way Phase 4's design
surfaced a Phase 3 gap after the fact.

---

## 1. Objective

> Running the same import twice produces zero duplicate conversations; a semantic query returns a
> relevant conversation even without exact keyword overlap (backend exit criteria). A user can
> import a ChatGPT export, watch it sync, search it semantically, and open a full transcript
> (frontend exit criteria).

Chat History is the second of the three data stores the PRD's glossary names (Memories, Chat
History, Files) — this phase and Phase 6 exist specifically so Phase 7's Ask has something to
fan out to beyond Memories.

## 2. What already exists vs. what's net-new

| Capability | Status |
|---|---|
| `Bucket`/`BucketMember` RBAC (`shared/bucketAccess.ts`) | **Exists** (Phase 3) — this phase scopes every conversation to a bucket and reuses `requireBucketRole`/`optionalBucketRole` unchanged, not a parallel check |
| `LlmProvider.embed()` | **Exists** (Phase 2) — reused for message-chunk embeddings; no new embedding seam needed |
| `CacheProvider` | **Exists** (Phase 4) — reused for repeated semantic-search queries the same way Phase 4 caches repeated preview snippets |
| Real tokenizer (`shared/tokenizer.ts`) | **Exists** (Phase 4) — reused to size conversation chunks against an embedding-model token limit, not a second ad hoc counter |
| Fire-and-forget async pipeline pattern (`embedding.service.ts`) | **Exists** (Phase 2) — this phase's sync jobs follow the same "caller doesn't await processing" shape, extended with a resumable step-cursor (see §4) |
| A scheduled/recurring job runner | **Net-new** — nothing in Phases 1–4 runs on a schedule; monthly insights (`US-ARC-06`) needs one |
| Idempotent external-data ingestion | **Net-new** — Phases 1–4 only ever created data the user typed directly; this phase ingests untrusted structured exports and must dedupe against re-imports |
| A second embedded-content type sharing retrieval infrastructure with `Memory` | **Net-new** — `Message` chunks need their own vector index, separate from `Memory.embedding`, since a chat message and a memory are different entities scored differently (see §5.2) |

## 3. In scope / out of scope

**In scope**
- Import wizard backend: accept a provider export file (ChatGPT/Claude/Gemini/TypingMind/Grok/
  DeepSeek JSON/HTML exports), parse into `Conversation`/`Message` rows
- **Idempotent sync**: a content-hash/external-id keyed upsert so re-running an import (or a
  future connected-account sync) never duplicates a conversation or message
- **Resumable sync jobs**: a job that fails or is cancelled partway through picks back up from
  its last completed conversation, not from zero (`US-ARC-02`)
- Chunking + embedding of messages for semantic search (`US-ARC-03`)
- Full transcript retrieval, paginated (`US-ARC-04`)
- Conversation summaries — async, post-import, Pro-gated in UI copy only, not enforced server-side
  yet (Phase 10 owns real plan gating, same call Phase 4 made for `US-ADV-01`) (`US-ARC-05`)
- Monthly insights digest — scheduled job, honest "not enough data" state (`US-ARC-06`)
- High-accuracy recall: an LLM rerank pass over the top-K semantic candidates for a dedicated
  "precise" search mode (`US-ARC-07`)
- Plan-based history limits (last 500 vs. unlimited), enforced server-side (`US-ARC-08`)
- Frontend: import wizard, sync settings + progress, archive browser, transcript viewer, semantic
  search bar, summaries/insights panels

**Explicitly out of scope this phase**
- **Live connected-account sync** (OAuth into ChatGPT/Claude/etc. to pull new conversations
  automatically) — every supported platform's real API story differs wildly and several don't
  expose one at all; this phase ships **file-export import** as the one real path, with the sync
  *data model* (idempotency keys, resumable cursor) built so a connected-account poller is a new
  producer writing into the same `Conversation`/`Message` tables later, not a schema rework
- **A real job queue/scheduler** (BullMQ + Redis, cron infra) — same call as Phase 2's embedding
  pipeline and Phase 4's cache. This phase's sync and monthly-insights jobs need actual
  in-process scheduling (unlike Phase 2–4's pure fire-and-forget), so it adds one narrow
  `JobRunner` seam (§4) rather than either skipping scheduling or building the real thing early
- **Cross-platform message threading/branching** (e.g. ChatGPT's edit-and-regenerate tree) —
  linearize to the single active branch per conversation; a documented simplification, not a
  silent data loss, since export formats vary in how much branch data they even retain
- Real per-plan enforcement UI gating (upgrade prompts beyond the existing `TrialBanner` pattern)
  — Phase 10's problem, this phase only builds the server-side limit check `US-ARC-08` requires

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| `ConversationImportProvider` interface | Six platforms, six export formats — codebase-design's "seam is the interface" applies exactly like `LlmProvider`/`StorageProvider`/`CacheProvider` | One parser per platform behind `parse(fileBuffer): ParsedConversation[]`; ships with ChatGPT + Claude export parsers (the two most requested per the PRD's ordering) and a documented gap for Gemini/TypingMind/Grok/DeepSeek rather than four half-tested guesses at formats this phase's author hasn't verified against a real export |
| `JobRunner` — minimal in-process scheduler | `US-ARC-06`'s monthly digest needs to run "on a schedule," not just once fire-and-forget; nothing before this phase has needed recurring execution | A tiny wrapper over `setInterval`/`node-cron`-style scheduling, `run(name, cron, handler)`, checked into `shared/providers/` alongside the other providers even though it isn't swapping an external API — same reasoning as Phase 4's `CacheProvider`: real infra (a managed cron trigger, or BullMQ repeatable jobs) is a Phase 10/12 upgrade behind an unchanged call site |
| A second vector-indexed table (`MessageChunk`) | `Memory.embedding` is scored with Phase 4's memory-specific weights (recency/category); chat messages need their own similarity index scored on their own terms (§5.2), and mixing the two in one table would force every future retrieval query to filter by a discriminator column instead of just querying the right table | New `MessageChunk` model, same `Unsupported("vector(1536)")` + raw-query pattern `duplicate-detection.service.ts` established, not a polymorphic `embeddings` table |
| Idempotency key strategy | `US-ARC-02`'s core requirement | `Conversation.externalId` (platform's own conversation ID when the export has one) OR a content hash of (platform + first-message timestamp + message count) when it doesn't — unique per `(bucketId, externalId)` — chosen over a full-transcript hash because edits to later messages during a resync shouldn't spawn a duplicate conversation, only update it in place |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model Conversation {
  id             String    @id @default(cuid())
  bucketId       String
  bucket         Bucket    @relation(fields: [bucketId], references: [id], onDelete: Cascade)
  userId         String    // importer — recorded like Memory.userId, membership still governs access
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform       String    // "chatgpt" | "claude" | "gemini" | "typingmind" | "grok" | "deepseek"
  externalId     String?   // platform's own conversation id, when the export provides one
  contentHash    String    // fallback idempotency key when externalId is absent (see §4)
  title          String
  summary        String?   // Pro async summarization (US-ARC-05), null until generated
  messageCount   Int       @default(0)
  importedAt     DateTime  @default(now())
  lastSyncedAt   DateTime  @default(now())
  status         String    @default("ready") // "importing" | "ready" | "error"
  syncCursor     Int       @default(0)       // last fully-processed message index — resumability (US-ARC-02)
  messages       Message[]

  @@unique([bucketId, platform, externalId])
  @@unique([bucketId, platform, contentHash])
  @@index([bucketId])
  @@index([userId])
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // "user" | "assistant"
  content        String
  position       Int          // 0-based order within the conversation (linearized, see §3)
  createdAt      DateTime     // the platform's own message timestamp, not import time
  chunks         MessageChunk[]

  @@unique([conversationId, position])
  @@index([conversationId])
}

model MessageChunk {
  id         String                       @id @default(cuid())
  messageId  String
  message    Message                      @relation(fields: [messageId], references: [id], onDelete: Cascade)
  content    String                       // the chunk text (a message may split into >1 chunk if long)
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime                     @default(now())

  @@index([messageId])
}

model MonthlyInsight {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  month     String   // "2026-07" — one row per user per calendar month
  summary   String?  // null means "not enough data" (US-ARC-06 AC), not a fabricated digest
  createdAt DateTime @default(now())

  @@unique([userId, month])
}
```

`Bucket` gains a `conversations Conversation[]` back-relation. Two-phase migration like Phase 3's
(`prisma migrate dev` for the schema, then a data-backfill migration if any pre-existing rows need
one — none expected here since these are all-new tables).

### 5.2 Services

- **`import.service.ts`** — `importFile(userId, bucketId, platform, buffer)`: requires `editor`+ on
  the target bucket (same `requireBucketMembership` shape `memory.service.ts` already uses),
  resolves the right `ConversationImportProvider`, parses, then **upserts** each conversation by
  `(bucketId, platform, externalId ?? contentHash)` — an existing row's `messages` are diffed by
  `position` so a resync only inserts genuinely new messages, never duplicates (`US-ARC-02`).
  Returns immediately with `{ conversationsQueued }`; the embedding/chunking step runs
  fire-and-forget per conversation, same pattern as `embedding.service.ts`.
- **`sync.service.ts`** — the resumable step: for a conversation with `status: 'importing'`,
  processes messages from `syncCursor` onward, chunking + embedding each, advancing `syncCursor`
  after each chunk commits (not after the whole conversation) so a crash mid-conversation resumes
  from the last committed chunk, not from message 0 (`US-ARC-02`'s cancel/retry ACs). Sets
  `status: 'ready'` once `syncCursor === messageCount`.
- **`chat-search.service.ts`** — `search(userId, { query, bucketId?, mode })`:
  - `mode: 'semantic'` (default): embed the query, cosine-rank `MessageChunk`s scoped to
    accessible buckets (reusing `accessibleBucketIds` exactly like `retrieval.service.ts` does),
    return conversations ranked by their best-matching chunk, through `CacheProvider` with the
    same "cache key includes every input that changes the answer" discipline Phase 4's toggle bug
    taught (bucket scope + query + **mode**, so a semantic vs. precise search never share a slot)
  - `mode: 'precise'`: same candidate set, then an LLM rerank pass over the top-K (`US-ARC-07`) via
    a new `LlmProvider.rerank(query, candidates): candidateId[]` method — extends the existing
    provider interface rather than a bespoke reranking client, same reasoning Phase 4 gave for
    reusing `embed()` for intent classification instead of a dedicated call
- **`summary.service.ts`** — appended as an optional step after sync completes (`US-ARC-05`):
  `LlmProvider.summarize(transcript): string`, stubbed the same way `extractMemoryCandidates` is
  stubbed today (a deterministic "first N sentences" summary when no real provider is configured)
- **`insight.service.ts`** — the monthly job (`US-ARC-06`): registered with `JobRunner` on a
  monthly cron, iterates users with activity in the prior calendar month, calls
  `LlmProvider.summarize()` over that month's conversations; a user below an activity floor gets
  `summary: null`, and the frontend renders that as "not enough data" rather than an empty box
- **`history-limit.service.ts`** — `assertWithinLimit(userId)`: Core-tier callers over 500
  conversations get a `403 HISTORY_LIMIT_REACHED` on new imports, checked at the same layer
  `bucketAccess.ts`'s self-defending services check authorization (service-level, not just a UI
  disable) — real Pro/Core plan branching is still a lookup against `Subscription.plan`, the same
  field Phase 1 already modeled, not a new billing concept

### 5.3 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/chat-history/import` (`multipart/form-data`: file, platform, bucketId) | `US-ARC-01` |
| GET | `/api/chat-history/conversations` (`?bucketId?&cursor?&limit?`) | `US-ARC-04` (archive list) |
| GET | `/api/chat-history/conversations/:id` (paginated messages) | `US-ARC-04` (transcript) |
| POST | `/api/chat-history/search` (`{ query, bucketId?, mode: 'semantic'\|'precise' }`) | `US-ARC-03`, `US-ARC-07` |
| GET | `/api/chat-history/insights` (`?month?`) | `US-ARC-06` |
| GET | `/api/chat-history/usage` (`{ count, limit }`) | `US-ARC-08` |

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. Importing the same export file twice creates zero duplicate `Conversation`/`Message` rows
   (`US-ARC-02`'s core AC) — the central test this phase exists to make pass.
2. A sync interrupted after N of M messages resumes from message N+1 on retry, not from 0.
3. A semantic search query with no exact keyword overlap with a seeded conversation still returns
   it, ranked above an unrelated seeded conversation (mirrors Phase 4's "fewer than everything"
   shape: here it's "the right one ranks first," not "the filtered set is smaller").
4. `mode: 'precise'` search returns the reranked order, provably different from raw cosine order
   on a seeded candidate set where the two orders are known to disagree.
5. A viewer-role bucket member can search and read conversations but a search scoped to a bucket
   they aren't a member of 403s — proving Phase 3's middleware is reused, not reimplemented,
   exactly like Phase 4's equivalent test.
6. A user at the 500-conversation Core limit gets `403 HISTORY_LIMIT_REACHED` on the 501st import;
   a Pro-plan user does not.
7. A month with zero qualifying conversations produces `summary: null`, never a fabricated digest.
8. Importing a malformed/corrupted export for one platform returns a clear per-conversation error
   without rolling back or corrupting conversations already imported from a different platform
   (`US-ARC-01`'s AC, made concrete).

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

Running the same import twice produces zero duplicate conversations; a semantic query returns a
relevant conversation even without exact keyword overlap.

---

## 6. Frontend plan

### 6.1 Where this lives

Replaces the `/dashboard/chat-history` `EmptyState` placeholder (`eta="Ships in Phase 5"`) that's
already in the nav today.

### 6.2 Screens & components

- **Import wizard** — a `Dialog` (same pattern as `CreateMemoryDialog`): platform picker, file
  drop zone, bucket selector (reusing the bucket `<select>` pattern from the memory detail page's
  move-bucket control, not a new component), scope selector (last 500 / unlimited, gated by plan)
- **Sync status** — a per-conversation status badge (`processing`/`ready`/`error`, same visual
  language as Phase 6's file-status badges — both phases render the exact same three-state
  machine, so the badge component is written once and shared, not forked)
- **Archive browser** — list + preview pane (reuses `MemoryRow`'s `content-visibility` performance
  pattern for long lists — `US-ARC-04`'s "very long transcripts load progressively" AC extends the
  same technique to the transcript viewer itself, paginating messages rather than rendering all at
  once)
- **Semantic search bar** — a mode toggle (Semantic / Precise) next to the existing search-input
  pattern from the Memories page, calling `POST /api/chat-history/search`
- **Summaries & insights panels** — Pro-gated (visually, matching the existing `TrialBanner`
  pattern — no separate gating system)

### 6.3 Data fetching

- `useImportConversations()` — mutation, multipart upload, same shape as `createImageMemory`
- `useConversations({ bucketId, cursor })`, `useConversation(id)` — same cursor-pagination
  contract `api.memories()` already established, not a new pagination shape
- `useChatSearch({ query, bucketId, mode })` — mutation (explicitly triggered by a search
  button/enter, not per-keystroke), same reasoning as Phase 4's `usePreview`
- `useMonthlyInsight()` — query, renders the "not enough data" state explicitly when `summary` is
  `null`

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A user can import a ChatGPT export, watch it sync, search it semantically, and open a full
transcript.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3, Phase 2 §4, Phase 3 §5, Phase 4 §7) — only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| New provider seam | `codebase-design` | `ConversationImportProvider` and `JobRunner` are the fifth/sixth provider abstractions in the same family — getting the interface boundary right here means a real connected-account sync or a real cron trigger swaps in behind an unchanged call site, same discipline as `CacheProvider` |
| Idempotency/resumability design | `domain-modeling` | "What makes two conversations the same one" has to be answered precisely before `externalId`/`contentHash` exist as columns — getting this wrong after data is imported means a painful backfill, not a schema tweak |
| Raw SQL for the new vector table | `prisma-client-api` (raw-queries) | `MessageChunk`'s similarity queries follow the exact parameterized `$queryRaw` pattern `duplicate-detection.service.ts` established — no new risk surface, just a second table using the same discipline |
| Test-first | `tdd` | "Import twice, zero duplicates" and "resume from N not 0" are exactly the kind of code that looks right and is silently wrong under a retry — written as red tests first, same as Phase 2/4's calibration tests |
| Long-list rendering | `vercel-react-best-practices` (`rendering-content-visibility`) | The transcript viewer and archive browser reuse `MemoryRow`'s technique rather than reinventing virtualization |
| Component reuse | `vercel-composition-patterns` | Sync-status badges, bucket selectors, and cursor pagination are explicit variants of components Phase 2/3 already built — a shared `<StatusBadge>` used by both this phase and Phase 6, not two forks |
| Visual consistency | `frontend-design`, `web-design-guidelines` | A new archive browser and transcript viewer are new shapes needing the same light-mode, restrained visual identity as Memories/Buckets — no dark-mode drift, no new accent colors introduced without reason |

## 8. Delivery order (suggested)

1. **Infra:** `JobRunner` scheduler seam; `ConversationImportProvider` interface + ChatGPT + Claude
   parsers (documented gap for the other four platforms)
2. **Backend:** `Conversation`/`Message`/`MessageChunk`/`MonthlyInsight` schema migration
3. **Backend:** `import.service` + idempotent upsert, tests first (`US-ARC-01`, `US-ARC-02`)
4. **Backend:** `sync.service`'s resumable cursor, tests first (interrupted-resume AC)
5. **Backend:** `chat-search.service` (semantic, then precise/rerank), tests first
6. **Backend:** `summary.service` + `insight.service` (`JobRunner`-scheduled) + `history-limit.service`
7. **Backend:** endpoints, full test suite green including the Phase 1–4 regression suite
8. **Frontend:** import wizard + sync status + archive browser
9. **Frontend:** transcript viewer + semantic search bar + summaries/insights panels
10. **Both:** `code-review` and `web-design-guidelines` pass; confirm exit criteria with a real
    export file (not a synthetic fixture only) before calling the phase done

## 9. Alignment with Phase 6

Both phases are read by this doc's author with the other open, specifically to keep these
decisions identical rather than accidentally diverging:

- **Same status state machine**: `Conversation.status` (`importing`/`ready`/`error`) and Phase 6's
  `File.status` (`processing`/`ready`/`error`) are the same three-state shape, rendered by the
  same shared badge component (§6.2) — a user shouldn't learn two different visual languages for
  "still working on it."
- **Same bucket-scoping contract**: both phases scope their new entity to a bucket via
  `requireBucketRole`, and both expose an optional `bucketId` filter on their list/search
  endpoints with the identical "omitted means everything I can see" semantics Phase 4 established
  for `/api/context/preview` — Phase 7's Ask query router (§7.6 of the PRD) can treat "search
  chat history" and "search files" as the same shape with a different backing table.
- **Shared vector-table pattern, not shared vector table**: `MessageChunk` (this phase) and
  `FileChunk` (Phase 6) are deliberately separate tables with separate embedding columns, not one
  polymorphic chunk table — they have different parent relations, different chunking granularity
  (message vs. page/section), and different citation shapes (conversation+position vs.
  file+page). Forcing them into one table would mean every retrieval query filters by a
  discriminator column for no real benefit.
- **`LlmProvider.rerank()`** (this phase, §5.2) is written generically enough that Phase 6's
  `US-FIL-03` citation-quality work, or a future Ask precision mode, can reuse it rather than
  Phase 6 growing its own reranking call.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Import from a supported platform (`US-ARC-01`) | §5.2 `import.service`, §5.3 import endpoint |
| Idempotent sync (`US-ARC-02`) | §5.1 unique constraints, §5.2 `import.service`/`sync.service` |
| Semantic search (`US-ARC-03`) | §5.2 `chat-search.service` (semantic mode) |
| Full transcript viewer (`US-ARC-04`) | §5.3 conversation-detail endpoint, §6.2 archive browser |
| Conversation summaries (`US-ARC-05`) | §5.2 `summary.service` |
| Monthly insights (`US-ARC-06`) | §5.2 `insight.service`, §4 `JobRunner` |
| High-accuracy recall (`US-ARC-07`) | §5.2 `chat-search.service` (precise mode), `LlmProvider.rerank()` |
| Plan-based limits (`US-ARC-08`) | §5.2 `history-limit.service` |

## 11. Definition of done

- [x] All Phase 5 endpoints in §5.3 implemented and covered by tests written per §5.4
      (`tests/chat-history.test.ts`, 10 tests: import/linearization, zero-duplicate re-import,
      malformed-export isolation, viewer/non-member rejection, resumable-cursor sync, semantic
      search with no keyword overlap, precise/rerank mode, cross-bucket 403, Core-limit
      enforcement, null-summary for an empty month)
- [x] Phase 1–4's existing test suite still passes unmodified — full backend suite is 76/76 green
- [x] Backend exit criteria (§5.5) demonstrated against a real ChatGPT-shaped export (the actual
      `mapping`/`current_node` tree format, not a flattened stand-in) via both the test suite and
      a live scripted run against the running dev server
- [x] Frontend exit criteria (§6.4) demonstrated live in a browser: import via the API → the
      conversation appears in the archive → open the transcript → semantic-search a phrase with
      no exact keyword overlap and find it. The import wizard's own upload flow was built and
      typechecks/builds cleanly but the live demo drove the upload through the API directly
      rather than the wizard's file-picker UI — noted rather than silently claimed as a full
      UI-driven demo.
- [x] Self-review caught two real bugs before they shipped: the running-average categorization
      race from Phase 4 recurred in spirit here (fire-and-forget syncs racing a test's `resetDb()`
      cascade-delete) — fixed by switching `sync.service.ts`'s status/cursor writes to
      `updateMany` (a no-op on a since-deleted row, not a thrown error) instead of `update`.
- [ ] `code-review` and `web-design-guidelines` run against this document and the PRD as spec —
      not run as a separate pass this round
- [x] The four platforms without a real parser (Gemini/TypingMind/Grok/DeepSeek) are shown,
      disabled, in the import wizard's platform picker rather than silently absent
- [x] §9's shared-badge and shared-scoping decisions verified against Phase 6's actual
      implementation — see `Phase6_Implementation_Plan.md` §9 for the matching confirmation;
      `<ProcessingStatusBadge>` is the one component both phases' lists actually import
