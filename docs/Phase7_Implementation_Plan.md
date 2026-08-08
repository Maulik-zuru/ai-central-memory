# Phase 7 Implementation Plan — The "Ask" Unified Query System

**Source documents:** `Product_Requirements.md` §7.6 (`US-ASK-01`–`06`), `Backend_Plan.md` Phase 7,
`Frontend_Plan.md` Phase 7
**Companion documents:** `Phase4_Implementation_Plan.md` (memory retrieval), `Phase5_Implementation_Plan.md`
(chat search), `Phase6_Implementation_Plan.md` (file RAG) — this phase does not reimplement any of
their retrieval logic. It is the thinnest phase in the roadmap by design: a router that calls three
already-shipped retrieval services in parallel and one synthesis call that reuses a provider method
Phase 6 already introduced. **`Phase8_BrowserExtension_Implementation_Plan.md` §9 explicitly
anticipates this phase** ("Ask-mode-ready, not Ask-mode-built") — Quick Inject's request shape was
deliberately kept identical to `context/preview`'s so that adding an "Ask this bucket" mode there,
once this phase ships, is a new button calling a new endpoint, not a rearchitecture.

---

## 1. Objective

> A single Ask query can return an answer sourced from a memory, a past conversation, and a file
> simultaneously, each cited correctly (backend exit criteria). A single question can be answered
> by blending a memory, a past conversation, and a document, with all three sources shown and
> clickable (frontend exit criteria).

Every other phase built one data store. This phase is the payoff: the first surface where a user
stops having to know *where* an answer lives.

## 2. What already exists vs. what's net-new

This table matters more than usual for this phase — almost everything Ask needs to *retrieve*
already exists; the only genuinely new work is the *fan-out, synthesis, and persistence* around it.

| Capability | Status |
|---|---|
| Memory retrieval + ranking — `retrieval.service.ts`'s `scoreCandidates()` | **Exists** (Phase 4) — similarity + recency + category scoring against `Memory`, bucket-scoped |
| Chat history semantic search — `chat-search.service.ts` | **Exists** (Phase 5) — cosine-ranked `MessageChunk`s, bucket-scoped, with an optional LLM rerank pass already wired |
| File RAG search — `file-search.service.ts` / `rag.service.ts` | **Exists** (Phase 6) — cosine-ranked `FileChunk`s with page citations, bucket-scoped |
| Grounded-answer synthesis — `LlmProvider.answerWithContext(question, chunks: {id, content}[])` | **Exists** (Phase 6, introduced for single-file Q&A) — its signature is already source-agnostic: it takes generic `{id, content}` pairs and returns `{answer, usedChunkIds}`. Ask reuses this **unchanged**, feeding it memories, message chunks, and file chunks side by side, rather than adding a second synthesis method |
| Bucket-scoped, "omitted means everything I can see" query contract | **Exists** (Phase 3/4/5/6, all identical) — Ask's mode+bucket filter is the same shape a fourth time, not a new design |
| `CacheProvider`, tokenizer | **Exist** (Phase 4) — reused for repeated Ask queries and citation-snippet budgeting |
| Cross-source ranking, synthesis-then-fan-out orchestration | **Net-new** — nothing before this phase has needed to combine three different embedding spaces' results into one ranked, budgeted, multi-type citation list |
| Resumable multi-turn threads (`AskConversation`/`AskMessage`) | **Net-new** — `Phase5_Implementation_Plan.md`'s `Conversation`/`Message` models are *imported* chat history (read-only archive); Ask's threads are a distinct, writable, app-native conversation the user has *with the platform itself* — deliberately separate tables, not a repurposing of Phase 5's (see §5.1) |

## 3. In scope / out of scope

**In scope**
- **Query router**: given a mode (`memories` / `chat_history` / `files` / `all`) and optional
  `bucketId`, fan out to the relevant retrieval service(s) in parallel (`US-ASK-02`)
- **Synthesis**: one `answerWithContext()` call over the merged, budgeted candidate set from
  whichever sources were queried
- **Citation assembly**: map each `usedChunkId` back to its source type, source id, and a
  clickable reference (memory id / conversation id + message position / file id + page)
  (`US-ASK-03`)
- **Honest "no relevant context" response** when nothing above a relevance floor exists in any
  queried source (`US-ASK-01`'s third Given/When/Then)
- **Resumable threads**: `AskConversation`/`AskMessage` persistence, a follow-up question run with
  prior turns as conversational context (`US-ASK-04`)
- **Bucket-scoped Ask**, identical semantics to every other bucket filter in the app (`US-ASK-05`)
- **Copy-response** — a frontend-only concern (`US-ASK-06`), no backend work
- Frontend: Ask chat interface, mode selector, source reference chips, saved/resumable thread
  list, bucket filter, copy action

**Explicitly out of scope this phase**
- **Cross-source result re-ranking beyond per-source relevance** — each source's own ranking
  (Phase 4/5/6's scoring) is trusted as-is; Ask does not build a fourth, unified relevance model
  across heterogeneous embedding spaces. Sources are merged by taking each one's top-K and letting
  the synthesis LLM decide what to actually cite — simpler, and avoids inventing a cross-space
  similarity metric this phase has no calibration data for (the same "first calibrated guess, not
  a settled constant" honesty Phase 4's ranking weights already modeled, except here the honest
  answer is "don't invent one yet")
- **Streaming responses** — Ask returns a complete answer per turn, not a token stream. Real-time
  streaming is a meaningful frontend/backend protocol change (SSE or similar) that no other phase
  has needed yet; adding it later is additive to this phase's endpoint, not a blocker to shipping
  a working synchronous version first
- **Voice input, file attachments inside Ask itself** — not in the PRD's Ask user stories; Ask
  reads from Memories/Chat History/Files, it doesn't gain its own new ingestion path
- **Automatic mode selection** ("guess which mode the user meant") — `US-ASK-02` asks for explicit
  mode selection; inferring intent automatically is a plausible future enhancement, not this
  phase's job

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| None — this phase adds no new provider seam | Every retrieval primitive it needs (`LlmProvider.embed()`/`.answerWithContext()`, `CacheProvider`, the tokenizer, `accessibleBucketIds`/`requireBucketMembership`) already exists from Phases 2–6 | Deliberate: a phase whose entire job is composing existing pieces should not need new infrastructure to do it. If this phase found itself needing a new provider, that would be a sign the composition is wrong, not a sign infra is missing |
| `ask.service.ts`'s merge-and-budget step | Three sources' top-K candidates need to become one token-budgeted list before synthesis | Not a provider — an orchestration function local to this module (see §5.2). It calls the *existing* internal candidate-scoring functions each source already exposes (`retrievalService.scoreCandidates()`, and two small new exports described in §5.2) rather than re-querying through their public search()/preview endpoints, which would truncate content and waste an HTTP-shaped round trip that doesn't apply to an in-process call |

Two of the three sources' existing services need a small, additive export to make this composition
possible without duplicating their raw SQL — not a redesign of either:

- `chat-search.service.ts` already computes best-chunk-per-conversation candidates internally;
  export that step (`topCandidates(bucketIds, embedding): CandidateRow[]`) instead of only the
  already-mapped-to-preview `search()` return shape.
- `file-search.service.ts` similarly exports its best-chunk-per-file candidates
  (`topCandidates(bucketIds, embedding): CandidateRow[]`) alongside its existing `search()`.

Both changes are purely additive (a new exported function beside the existing one) — `search()`'s
existing callers and tests are untouched.

## 5. Backend plan

### 5.1 Schema additions

```prisma
// Ask's own threads — an app-native conversation the user has with the platform, distinct from
// Phase 5's *imported* Conversation/Message (a read-only archive of a chat that happened
// elsewhere). Naming them separately (Ask- prefix) avoids the confusion of two different things
// both being called "Conversation."
model AskConversation {
  id        String       @id @default(cuid())
  bucketId  String?      // null means "was asked across every bucket the user could see"
  bucket    Bucket?      @relation(fields: [bucketId], references: [id], onDelete: SetNull)
  userId    String
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String       // derived from the first question, editable later (not this phase)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  messages  AskMessage[]

  @@index([userId])
  @@index([bucketId])
}

model AskMessage {
  id                String          @id @default(cuid())
  conversationId    String
  conversation      AskConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role              String          // "user" | "assistant"
  content           String          // the question, or the synthesized answer
  mode              String?         // "memories" | "chat_history" | "files" | "all" — set on user turns
  citations         Json?           // Citation[] (see §5.2) — set on assistant turns, null on user turns
  position          Int
  createdAt         DateTime        @default(now())

  @@unique([conversationId, position])
  @@index([conversationId])
}
```

`Bucket.askConversations AskConversation[]` and `User.askConversations AskConversation[]`
back-relations. `bucketId` is nullable — unlike every other bucket-scoped model so far, an Ask
thread can legitimately span "everything," and that scope is a property of the *thread*, fixed at
creation (switching a thread's bucket scope mid-conversation would silently change what its later
turns can see without the user re-asking — simpler and more honest to require a new thread for a
new scope, matching `US-ASK-02`'s "switching modes re-runs retrieval" AC being about *mode*, not
*bucket*).

### 5.2 Services

- **`ask.service.ts`** — the query router and orchestrator:
  - `ask(userId, { conversationId?, question, mode, bucketId? })`:
    1. Resolve or create the `AskConversation` (new thread if `conversationId` omitted; append to
       an existing one — validated to belong to `userId` — otherwise).
    2. Resolve scope: `bucketId` given → `requireBucketMembership(userId, bucketId, 'viewer')`;
       omitted → `accessibleBucketIds(userId)` (identical contract to every prior phase).
    3. Embed the question once (`LlmProvider.embed()`), reused across every source queried this
       turn — one embedding call, not one per source.
    4. Fan out **in parallel** (`Promise.all`) to whichever sources `mode` selects:
       - `memories`/`all` → `retrievalService.scoreCandidates(bucketIds, embedding)`
       - `chat_history`/`all` → `chatSearchService.topCandidates(bucketIds, embedding)`
       - `files`/`all` → `fileSearchService.topCandidates(bucketIds, embedding)`
    5. Tag each candidate with its source type and merge into one list, sorted by each source's
       own similarity score (§3 — no cross-space re-ranking), then token-budget it (reusing
       `shared/tokenizer.ts`) into the final chunk set passed to synthesis.
    6. If the merged, budgeted set is empty (nothing above each source's own relevance floor —
       Phase 6's `RELEVANCE_DISTANCE_CEILING` pattern, applied per source), skip the LLM call
       entirely and return the honest "I don't have relevant context for that" answer with zero
       citations (`US-ASK-01`'s third Given/When/Then) — never a hallucinated answer padded with
       irrelevant sources just because *something* was retrieved.
    7. Otherwise call `LlmProvider.answerWithContext(question, mergedChunks)` — **the same method
       Phase 6 introduced**, unchanged.
    8. Map `usedChunkIds` back to citations: `{ sourceType: 'memory'|'message'|'file', sourceId,
       snippet, meta }` where `meta` is `{ conversationId, position }` for a message source or
       `{ page }` for a file source — enough for the frontend to deep-link to exactly where Phase
       5's transcript viewer or Phase 6's citation click-through already lands.
    9. Persist both turns (`role: 'user'` with the question, `role: 'assistant'` with the answer
       and citations JSON) and return the assistant turn.
  - `listThreads(userId)`, `getThread(userId, id)` — for the resumable-thread list and detail view
    (`US-ASK-04`); both self-defend with an ownership check, same discipline every other module's
    service layer already follows.

### 5.3 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/ask` (`{ conversationId?, question, mode, bucketId? }`) | `US-ASK-01`, `US-ASK-02`, `US-ASK-03`, `US-ASK-05` |
| GET | `/api/ask/threads` (`?cursor?&limit?`) | `US-ASK-04` (thread list) |
| GET | `/api/ask/threads/:id` | `US-ASK-04` (resume a thread) |

No `DELETE`/rename endpoints this phase — thread management beyond list/resume isn't in the PRD's
Ask user stories; adding it later doesn't change this shape.

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. A question with relevant information split across a memory and an imported conversation, asked
   in `all` mode, returns an answer citing both sources — the central test this phase exists to
   make pass.
2. Every citation in a returned answer resolves to a source the user actually has access to (no
   citation ever points at a memory/conversation/file outside the queried bucket scope).
3. A question with no relevant information in any store returns the honest "no relevant context"
   response with zero citations, never a general-knowledge answer dressed up as sourced.
4. Switching `mode` on the same question (memories-only vs. all) changes which sources are queried
   and can change the answer — proving retrieval genuinely re-runs per mode, not a client-side
   filter of one cached call (`US-ASK-02`'s AC, made concrete).
5. Asking a follow-up in an existing thread includes prior turns' context in the request to
   synthesis (assert the second call's prompt contains the first turn's Q&A), and the thread's
   full history is retrievable via `GET /api/ask/threads/:id` in order.
6. Scoping to a bucket the caller isn't at least a viewer on 403s — proving Phase 3's middleware
   is reused here too, the fourth time this exact test shape has been written (Phase 4/5/6, now
   Phase 7).
7. A `bucketId`-scoped Ask never surfaces a memory/conversation/file from a different bucket, even
   one the same user owns — scope is exclusive, not just prioritized.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

A single Ask query can return an answer sourced from a memory, a past conversation, and a file
simultaneously, each cited correctly.

---

## 6. Frontend plan

### 6.1 Where this lives

Replaces the `/dashboard/ask` placeholder already in the nav today (same "ships in Phase N"
`EmptyState` pattern as chat-history/files had before Phases 5/6).

### 6.2 Screens & components

- **Ask chat interface** — a persistent thread view: prior turns rendered top-to-bottom (reusing
  the message-bubble visual language `chat-history/[id]`'s transcript viewer already established
  — user/assistant bubbles, not a new chat component invented from scratch), a composer at the
  bottom.
- **Mode selector** — the same segmented-control pattern the chat-history search bar's
  Semantic/Precise toggle already uses, extended to four options (Memories / Chat History / Files
  / All).
- **Bucket filter** — the same `<select>` pattern used everywhere else a bucket filter appears
  (memory detail's move-bucket control, Smart Memory's preview panel) — one more explicit variant
  of an existing pattern, per `US-ORG-03`'s "same component/behavior everywhere" requirement.
- **Source reference chips** — under each assistant turn, one chip per citation showing source
  type + a short label (a memory's first few words / a conversation's title / a file's name +
  page). Clicking a memory chip opens that memory's detail page; a chat-history chip opens
  `chat-history/[id]` (Phase 5's transcript viewer); a file chip opens `files/[id]` (Phase 6's
  citation view) — **three existing pages**, no new detail views built for this phase.
- **Thread list** — a sidebar or a `/dashboard/ask` landing list of past threads (title + last
  message preview + relative time), resuming into the chat interface on click.
- **Copy response** — a small icon button on each assistant turn; copies the answer text (the
  behavior split — with or without citation text — is: copies **just the answer text**, since
  citations are interactive UI elements, not part of the prose, and that's stated once in a
  tooltip rather than left ambiguous per `US-ASK-06`'s "clearly excluded by a documented,
  consistent behavior" AC).

### 6.3 Data fetching

- `useAskThreads()` — list query, same cursor-pagination contract as every other list.
- `useAskThread(id)` — thread detail query.
- `useAsk()` — mutation (`{ conversationId?, question, mode, bucketId? }`), explicitly triggered by
  submitting the composer, same "explicit trigger, not per-keystroke" reasoning as every other
  search/preview mutation in this codebase.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A single question can be answered by blending a memory, a past conversation, and a document, with
all three sources shown and clickable.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3, Phase 2 §4, Phase 3 §5, Phase 4 §7, Phase 5 §7, Phase 6 §7)
— only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Composition over new infra | `codebase-design` | The core discipline this phase tests: resist adding a new provider/seam when the existing ones already cover the need. The only interface change is two additive `topCandidates()` exports, not a rewrite of two services |
| Thread/turn modeling | `domain-modeling` | Deciding `AskConversation`/`AskMessage` must be distinct from Phase 5's `Conversation`/`Message` (imported vs. app-native) has to happen before the schema exists — collapsing them later, after Ask threads have real data, is a painful migration, not a naming fix |
| Test-first | `tdd` | "Cites sources the user actually has access to" and "no citation when nothing's relevant" are exactly the silently-wrong-looking-right code this discipline exists for, especially with three data sources' scoping to keep straight |
| Parallel fan-out correctness | `nodejs-backend-patterns` | The `Promise.all` fan-out across three async retrieval calls needs the same care Phase 2's fire-and-forget chain took — a rejection from one source shouldn't silently swallow the other two's results |
| Component reuse | `vercel-composition-patterns` | Message bubbles, the mode selector, and the bucket filter are explicit variants of components Phase 5/4/3 already built — a fourth-time reuse, not a fourth-time reinvention |
| Visual consistency | `frontend-design`, `web-design-guidelines` | Ask is the most visually complex new screen yet (persistent chat + citations + thread list) — must still read as the same notebook-identity product, not a bolted-on chatbot UI |

## 8. Delivery order (suggested)

1. **Backend infra:** add `topCandidates()` exports to `chat-search.service.ts` and
   `file-search.service.ts` (no behavior change to their existing `search()` callers/tests)
2. **Backend:** `AskConversation`/`AskMessage` schema migration
3. **Backend:** `ask.service`'s fan-out + merge + budget step, tests first (mode-switching AC,
   scope-exclusivity AC)
4. **Backend:** synthesis + citation assembly via the existing `answerWithContext()`, tests first
   (multi-source citation AC, honest-no-context AC)
5. **Backend:** thread persistence + follow-up context, tests first (thread-resume AC)
6. **Backend:** endpoints, full test suite green including the Phase 1–6 regression suite
7. **Frontend:** Ask chat interface + mode selector + composer
8. **Frontend:** source reference chips wired to the three existing detail pages + thread list
9. **Both:** `code-review` and `web-design-guidelines` pass; confirm exit criteria live with real
   seeded data spanning all three stores, not a synthetic single-source fixture

## 9. Alignment with Phase 8

- **Quick Inject's request shape is already Ask-shaped.** `Phase8_BrowserExtension_Implementation_Plan.md`
  §9 states this explicitly: once `/api/ask` exists, an "Ask this bucket" mode in the extension is
  a new button calling `POST /api/ask` with the extension's already-selected `bucketId` — no
  change to the injection pipeline built in Phase 8's extension slice.
- **Citations reuse Phase 5/6's existing detail views, which the extension does not need to
  reimplement.** The extension's Quick Inject flow only ever calls `context/preview` (Phase 4) —
  it has no reason to render Ask's citation chips itself. If a future extension surface *does* want
  to show an Ask answer in-page, it can reuse this phase's citation shape (`sourceType`, `sourceId`,
  `snippet`) directly rather than inventing one.
- **No change needed to Phase 8's scope enforcement (`requireScope`).** An extension-issued key's
  scopes (`memory:write`, `memory:read`, `context:read`, `bucket:read`, `suggestion:read/write`,
  `account:read`) don't yet include an `ask:*` scope, because Ask wasn't built when Phase 8's scope
  list was written. Adding `ask:read` to `EXTENSION_SCOPES` is a one-line follow-up in Phase 8's
  code whenever an extension "Ask this bucket" mode is actually built — not decided by default in
  this document, since this phase doesn't touch the extension at all.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Ask across Memories/Chat History/Files (`US-ASK-01`) | §5.2 `ask.service` fan-out + synthesis |
| Mode selection (`US-ASK-02`) | §5.2 step 4, §6.2 mode selector |
| Source references (`US-ASK-03`) | §5.2 step 8 citation assembly, §6.2 reference chips |
| Saved Ask conversations (`US-ASK-04`) | §5.1 `AskConversation`/`AskMessage`, §5.2 thread methods |
| Bucket-scoped Ask (`US-ASK-05`) | §5.2 step 2, reused Phase 3 RBAC |
| Copy response (`US-ASK-06`) | §6.2 copy button |

## 11. Definition of done

- [ ] All Phase 7 endpoints in §5.3 implemented and covered by tests written per §5.4
- [ ] Phase 1–6's existing test suite still passes unmodified — this phase adds two exported
      functions and two new tables, it doesn't touch any existing service's authorization logic
- [ ] Backend exit criteria (§5.5) demonstrated with real seeded data spanning a memory, an
      imported conversation, and a file — not three synthetic single-item fixtures that happen to
      share a keyword
- [ ] Frontend exit criteria (§6.4) demonstrated live: ask a question in `all` mode, see all three
      source chips, click each one and land on the right existing detail page
- [ ] `code-review` and `web-design-guidelines` run against this document and the PRD as spec
- [ ] §9's Phase 8 alignment is re-verified once the extension's "Ask this bucket" mode (if/when
      built) actually exists — this document only confirms the request shape is ready, not that
      the extension has been updated to use it
- [ ] The no-cross-space-reranking simplification (§3) is logged somewhere discoverable (this
      document) so a future phase revisiting Ask's answer quality knows it was a deliberate,
      documented gap and not an oversight
