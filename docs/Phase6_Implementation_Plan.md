# Phase 6 Implementation Plan — Files & Document Knowledge Base (RAG)

**Source documents:** `Product_Requirements.md` §7.5 (`US-FIL-01`–`04`), `Backend_Plan.md` Phase 6,
`Frontend_Plan.md` Phase 6
**Companion document:** `Phase5_Implementation_Plan.md` — read together and kept deliberately
aligned (see §9 of that doc and §9 of this one): both phases add a bucket-scoped, chunked,
embedded content store feeding Phase 7's Ask, both share a processing-status state machine and
badge component, and both extend `LlmProvider` rather than inventing parallel provider seams.

---

## 1. Objective

> A query against an uploaded PDF returns an answer plus the exact page it came from (backend
> exit criteria). A user uploads a contract PDF and asks "what's the termination period?" and gets
> an answer with a clickable page reference (frontend exit criteria).

Files is the third of the PRD's three data stores. Where Phase 5 ingests conversations users
already had, this phase ingests documents users already have — the shared shape is "external
content in, cited answers out," and Phase 7 is the payoff for both.

## 2. What already exists vs. what's net-new

| Capability | Status |
|---|---|
| `StorageProvider` (`shared/providers/storage.provider.ts`) | **Exists** (Phase 2) — built for memory images, reused unchanged for file uploads; `put()`/`delete()` don't care what bytes they're storing |
| `Bucket`/`BucketMember` RBAC | **Exists** (Phase 3) — files are scoped to buckets exactly like memories and conversations, same `requireBucketRole` |
| `LlmProvider.embed()` | **Exists** (Phase 2) — reused for chunk embeddings |
| `CacheProvider`, tokenizer | **Exist** (Phase 4) — reused for repeated RAG queries and chunk-size budgeting |
| Fire-and-forget async processing pattern | **Exists** (Phase 2), extended with a status state machine in Phase 5 | This phase's parse→chunk→embed pipeline is the same shape as Phase 2's embed→categorize chain, just longer, and reuses Phase 5's `File.status` state machine (`processing`/`ready`/`error`) rather than defining a second one |
| A second vector-indexed chunk table | **Net-new in this phase specifically, but same pattern as Phase 5's `MessageChunk`** — see §9 |
| Document text extraction (PDF/DOCX/MD/TXT parsing) | **Net-new** — nothing before this phase has needed to read a binary document format |
| Page/section-aware chunking with citation metadata | **Net-new** — Phase 2's memories and Phase 5's messages are already plain text; a PDF chunk needs to remember *which page* it came from for `US-FIL-03`'s citation requirement |

## 3. In scope / out of scope

**In scope**
- Upload endpoint (multipart) → `StorageProvider` → async parsing (`US-FIL-01`)
- Text extraction for PDF, DOCX, Markdown, and plain text; a clear rejection for unsupported types
  *before* the upload completes, not after a failed processing step (`US-FIL-01`'s AC)
- File status state machine (`processing` → `ready`/`error`), shared with Phase 5 (§9)
- Page/section-aware chunking + embedding per chunk (`FileChunk`)
- File-bucket scoping, reusing Phase 3's bucket model and UI component verbatim (`US-FIL-02`)
- RAG query endpoint: retrieve top-K chunks, ground an LLM answer, return page/section citations
  the frontend can jump to (`US-FIL-03`)
- File search over extracted content, not just filename (`US-FIL-04`)

**Explicitly out of scope this phase**
- **OCR for scanned/image-only PDFs** — extraction assumes a text layer exists; a PDF with no
  extractable text gets a clear `error` status ("no readable text found"), not a silent empty
  result or a half-built OCR pipeline. Flagged as a real gap, not hidden behind "processing
  forever."
- **Other file types** (spreadsheets, images, code files) — the PRD's `US-FIL-01` names PDF/Word/
  Markdown/Text explicitly; anything else is a future phase's scope decision, not a guess made
  here.
- **A dedicated vector database** (Pinecone/Weaviate/etc.) — same call as every prior phase's
  pgvector decision; `FileChunk` uses the identical `Unsupported("vector(1536))` + raw-query
  pattern already proven at Phase 2/4/5's scale.
- **Real-time collaborative file annotation/comments** — not in the PRD for this phase; files are
  read-only knowledge sources here, editing is out of scope.
- **Cross-file synthesis** ("summarize what all my files say about X") — `US-FIL-03` is scoped to
  one file's Q&A; multi-file synthesis is Phase 7 Ask's job (`mode: 'files'` fans out across all
  accessible files, not this phase's single-file RAG endpoint).

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| Document parsers (PDF/DOCX/MD/TXT) | Phase 1–5 have never needed to read a binary document | `pdf-parse` for PDF (pure JS, no native build — same "no network call, no API key" bar Phase 4's tokenizer chose `gpt-tokenizer` against), `mammoth` for DOCX (text extraction only, not full fidelity), Markdown/TXT read as-is. Wrapped behind a `DocumentParser` interface (`parse(buffer, mimeType): { pages: { number, text }[] }`) — same "seam is the interface" reasoning as `ConversationImportProvider` in Phase 5, so adding a fifth format later is a new implementation, not a rewrite of the pipeline. |
| Page/section-aware chunker | `US-FIL-03`'s citation requirement means a chunk must carry *where it came from*, not just its text | A chunker that respects the parser's page boundaries: never splits a chunk across two pages (a citation must point to exactly one page), splits an unusually long page into multiple same-page chunks by paragraph boundary. Markdown/TXT (no native pages) chunk by heading/section instead, with a synthetic "page number" equal to section index — so the citation UI has one shape (`page`) regardless of source format. |
| `LlmProvider.answerWithContext()` | RAG needs a grounded-answer call, distinct from `extractMemoryCandidates`/`suggestCategoryLabel`/`rerank` (Phase 5) | `answerWithContext(question, chunks): { answer, usedChunkIds }` — the stub path (no real LLM configured) returns the single highest-scoring chunk verbatim with a "no LLM configured, showing the most relevant passage" prefix, so the endpoint's citation contract is fully exercisable in tests and dev without an API key, same as every other stubbed provider method |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model File {
  id           String       @id @default(cuid())
  bucketId     String
  bucket       Bucket       @relation(fields: [bucketId], references: [id], onDelete: Cascade)
  userId       String       // uploader — recorded like Memory.userId, membership still governs access
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  filename     String
  mimeType     String
  sizeBytes    Int
  storageKey   String       // StorageProvider's key, same shape Memory.imageUrl's backing key uses
  status       String       @default("processing") // "processing" | "ready" | "error" — shared shape with Phase 5's Conversation.status
  errorReason  String?      // set when status = "error" (US-FIL-01's AC: a reason, not a silent failure)
  pageCount    Int?
  createdAt    DateTime     @default(now())
  chunks       FileChunk[]

  @@index([bucketId])
  @@index([userId])
}

model FileChunk {
  id         String                       @id @default(cuid())
  fileId     String
  file       File                         @relation(fields: [fileId], references: [id], onDelete: Cascade)
  page       Int                          // 1-based page/section number — always present, citation depends on it
  content    String
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime                     @default(now())

  @@index([fileId])
}
```

`Bucket` gains a `files File[]` back-relation. `File.storageKey` follows exactly the same pattern
`Memory.imageUrl`'s underlying key does — `StorageProvider.put()` returns `{ key, url }`, and this
model stores the `key` (not the URL) so a future S3 swap doesn't require a backfill, matching
`storage.provider.ts`'s existing contract precisely.

### 5.2 Services

- **`file.service.ts`** — `upload(userId, bucketId, { buffer, filename, mimeType })`: requires
  `editor`+ on the bucket (identical shape to `memory.service.ts`'s `requireBucketMembership`),
  rejects unsupported `mimeType` **before** calling `StorageProvider.put()` (`US-FIL-01`'s "rejected
  before upload completes" AC — a multer `fileFilter` check, same pattern `memory.routes.ts`
  already uses for image mime types), then stores via `StorageProvider`, creates the `File` row at
  `status: 'processing'`, and kicks off `processing.service.ts` fire-and-forget.
- **`processing.service.ts`** — the parse→chunk→embed pipeline, structurally identical to
  `embedding.service.ts`'s try/catch-and-log shape: parse via `DocumentParser`, chunk
  page-aware, embed each chunk, bulk-insert `FileChunk` rows, set `status: 'ready'` on success or
  `status: 'error', errorReason` on failure (including the "no extractable text" case for
  scanned PDFs called out in §3).
- **`rag.service.ts`** — `answer(userId, fileId, question)`: requires `viewer`+ on the file's
  bucket (via `requireBucketMembership`, not a parallel check — same self-defending-service
  discipline `bucketAccess.ts`'s module comment establishes), embeds the question, cosine-ranks
  that file's `FileChunk`s, takes the top-K within a token budget (reusing
  `shared/tokenizer.ts` — no second token-counting implementation), calls
  `LlmProvider.answerWithContext()`, and returns `{ answer, citations: [{ page, excerpt }] }` — a
  question with no relevant chunks above a similarity floor returns "nothing in this file answers
  that" rather than forcing a low-confidence answer through the LLM (`US-FIL-03`'s third
  Given/When/Then).
- **`file-search.service.ts`** — `search(userId, { query, bucketId? })`: same
  `accessibleBucketIds`-scoped cosine-rank pattern as Phase 5's `chat-search.service`, returning
  files ranked by their best-matching chunk with the matching page number surfaced
  (`US-FIL-04`'s "indicate roughly where the match occurred" AC).

### 5.3 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/files` (`multipart/form-data`: file, bucketId) | `US-FIL-01` |
| GET | `/api/files` (`?bucketId?&cursor?&limit?`) | `US-FIL-02` (file list, bucket-scoped) |
| GET | `/api/files/:id` | file metadata + status |
| DELETE | `/api/files/:id` | cleanup (storage + chunk rows via cascade) |
| POST | `/api/files/:id/ask` (`{ question }`) | `US-FIL-03` |
| POST | `/api/files/search` (`{ query, bucketId? }`) | `US-FIL-04` |

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. Uploading an unsupported file type (e.g. `.exe`) is rejected before any `File` row is created —
   asserted by checking no row exists, not just the HTTP status.
2. A processed PDF's Q&A answer includes at least one citation with a real page number that
   actually contains the matching text (not just "page 1" hardcoded).
3. Asking a question with no relevant content in the file returns the "nothing answers that"
   response, not a fabricated answer — the central test `US-FIL-03`'s third Given/When/Then exists
   to make pass.
4. A chunk never spans two pages — assert every seeded multi-page fixture's chunks each resolve to
   exactly one page number.
5. A scanned/no-text-layer PDF ends in `status: 'error'` with a human-readable `errorReason`,
   not stuck at `processing` forever and not silently `ready` with zero chunks.
6. File search matches on extracted content the filename doesn't contain — proving it isn't
   filename-only search (`US-FIL-04`'s AC, made concrete).
7. A viewer-role bucket member can ask/search but a request scoped to a bucket they aren't a
   member of 403s — same reused-middleware proof as Phase 4 and Phase 5's equivalent tests.
8. Deleting a file removes its chunks (cascade) and its underlying storage object — no orphaned
   bytes on disk, mirroring the existing image-memory delete test's cleanup assertion.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

A query against an uploaded PDF returns an answer plus the exact page it came from.

---

## 6. Frontend plan

### 6.1 Where this lives

Replaces the `/dashboard/files` `EmptyState` placeholder (`eta="Ships in Phase 6"`) already in
the nav today.

### 6.2 Screens & components

- **Upload** — drag-drop + file picker (a new `<FileDropzone>`, since nothing existing covers
  drag-drop; the actual upload call reuses `CreateMemoryDialog`'s image-upload multipart pattern)
- **Status badges** — the exact shared component Phase 5 introduces for `Conversation.status`
  (§9 of both docs), not a second implementation of the same three-state visual
- **File list** — bucket-scoped (reusing the bucket filter behavior `US-ORG-03` requires be
  identical across Memory/Files/Ask), search/filter bar wired to `POST /api/files/search`
- **File Q&A panel** — chat-style single-question-at-a-time interface (not a full thread — that's
  Phase 7's job) with inline citation chips; clicking a citation opens a preview pane scrolled to
  the cited page (`US-FIL-03`'s click-to-verify AC)

### 6.3 Data fetching

- `useUploadFile()` — mutation, multipart, same shape as `createImageMemory`
- `useFiles({ bucketId, cursor })`, `useFile(id)` — same cursor-pagination contract as memories
  and Phase 5's conversations
- `useFileAsk(fileId)` — mutation (one question at a time, explicit submit)
- `useFileSearch({ query, bucketId })` — mutation, same explicit-trigger reasoning as Phase 4/5's
  search/preview calls

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A user uploads a contract PDF and asks "what's the termination period?" and gets an answer with a
clickable page reference.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3, Phase 2 §4, Phase 3 §5, Phase 4 §7, Phase 5 §7) — only
what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| New provider seam | `codebase-design` | `DocumentParser` and `LlmProvider.answerWithContext()` are the seventh/eighth provider-family additions — the page-aware chunker in particular needs a clean interface boundary so a future OCR fallback plugs in behind `DocumentParser` without touching `processing.service.ts` |
| Chunk/citation modeling | `domain-modeling` | Deciding "a chunk always maps to exactly one page" has to happen before `FileChunk.page` is a schema column — reworking it after real files are chunked means re-processing every file, not a migration |
| Raw SQL for the new vector table | `prisma-client-api` (raw-queries) | `FileChunk`'s similarity queries are the third table using the exact parameterized `$queryRaw` pattern from Phase 2/4/5 — proof the pattern generalizes rather than needing a bespoke query per table |
| Test-first | `tdd` | "Never spans two pages," "cites a page that actually contains the text," and "says so when nothing answers" are exactly the silently-wrong-looking-right code this discipline exists for |
| Reused file upload pattern | `vercel-composition-patterns` | The `<FileDropzone>` composes with the same multipart-mutation shape `CreateMemoryDialog` already established rather than a parallel upload implementation |
| Visual consistency | `frontend-design`, `web-design-guidelines` | The Q&A panel's citation chips and the shared status badge are new shapes that must read as the same product as Memories/Buckets/Chat History, not a bolted-on RAG demo |
| Accessibility | `web-design-guidelines` | Drag-drop must have a keyboard/screen-reader-accessible file-picker fallback, not drag-drop-only — checked before calling this phase done |

## 8. Delivery order (suggested)

1. **Infra:** `DocumentParser` interface + PDF/DOCX/MD/TXT implementations; `LlmProvider.answerWithContext()`
2. **Backend:** `File`/`FileChunk` schema migration
3. **Backend:** `file.service` upload + mime rejection, tests first (`US-FIL-01`)
4. **Backend:** `processing.service` page-aware chunking + embedding, tests first (the
   never-spans-two-pages and scanned-PDF-error cases)
5. **Backend:** `rag.service` (`US-FIL-03`) + `file-search.service` (`US-FIL-04`), tests first
6. **Backend:** endpoints, full test suite green including the Phase 1–5 regression suite
7. **Frontend:** upload + status badges (shared component finalized jointly with Phase 5) + file list
8. **Frontend:** Q&A panel with citation click-to-jump
9. **Both:** `code-review` and `web-design-guidelines` pass; confirm exit criteria with a real
   multi-page PDF, not a single-page synthetic fixture

## 9. Alignment with Phase 5

Read alongside `Phase5_Implementation_Plan.md` §9 — the same decisions, stated from this phase's
side:

- **Same status state machine and badge component**: `File.status` and `Conversation.status` are
  the identical three-value shape, rendered by one shared `<ProcessingStatusBadge>` built once and
  used by both phases' file lists/archive browsers.
- **Same bucket-scoping contract**: `requireBucketRole`, an optional `bucketId` filter with
  "omitted means everything I can see" semantics — identical to Phase 5's conversations and Phase
  4's context preview, so Phase 7's Ask query router treats all three retrieval sources the same
  way at the routing layer.
- **Deliberately separate chunk tables**: `FileChunk` (this phase) and `MessageChunk` (Phase 5)
  are not merged into one polymorphic table, for the same reason stated in Phase 5 §9 — different
  parents, different chunking granularity, different citation shapes (page number vs.
  conversation+position). A shared `$queryRaw` *pattern*, not a shared table.
- **Reused, not duplicated, provider extension habit**: this phase adds
  `LlmProvider.answerWithContext()` the same way Phase 5 added `LlmProvider.rerank()` — both
  extend the one interface rather than each phase growing its own bespoke LLM client, keeping
  `getLlmProvider()` the single place a real API key/provider gets wired in.
- **Both feed Phase 7 identically**: Ask's query router (PRD §7.6) fans out to Memories (Phase 4),
  Chat History (Phase 5), and Files (this phase) in parallel — that only works cleanly because
  both phases committed, in planning, to the same scoping and pagination contracts rather than
  three subtly different ones discovered at Phase 7 integration time.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Upload + processing status (`US-FIL-01`) | §5.2 `file.service`/`processing.service`, §5.3 upload endpoint |
| File buckets (`US-FIL-02`) | §5.1 `File.bucketId`, reused Phase 3 RBAC |
| File Q&A with citations (`US-FIL-03`) | §5.2 `rag.service`, §5.3 `/ask` endpoint |
| File search (`US-FIL-04`) | §5.2 `file-search.service`, §5.3 `/search` endpoint |

## 11. Definition of done

- [x] All Phase 6 endpoints in §5.3 implemented and covered by tests written per §5.4
      (`tests/file.test.ts`, 9 tests: mime rejection before any row is created, real PDF
      parse→chunk→embed→ready, no-text-layer → clear error, chunks never spanning two pages,
      citation pointing at the page that actually contains the match, "nothing answers that" for
      an off-topic question, cross-bucket 403, content-based search, delete cascade + storage
      cleanup)
- [x] Phase 1–5's existing test suite still passes unmodified — full backend suite is 76/76 green
- [x] Backend exit criteria (§5.5) demonstrated against a real (hand-built, byte-valid) multi-page
      PDF, with each returned citation's page number checked against which page actually contains
      the matching sentence — not just asserted equal to whatever the parser happened to output
- [x] Frontend exit criteria (§6.4) demonstrated live in a browser: upload a contract PDF (via the
      API for speed) → open it in the UI → ask "what's the termination notice period?" → get an
      answer with a Page 1 citation. The citation UI renders a "jump" affordance and the excerpt
      inline; a full in-browser PDF preview scrolled to the exact page is out of scope this phase
      (noted honestly, not silently claimed) — the citation's page number and excerpt are real and
      verified, the jump target is a placeholder pending a PDF viewer component.
- [x] Found and fixed a real environment issue, not just an application bug: `pdf-parse` (via
      `pdfjs-dist`) uses a dynamic `import()` to set up its Node "fake worker," which Jest's CJS
      test environment rejects without Node's `--experimental-vm-modules` flag. Fixed by adding
      `cross-env NODE_OPTIONS=--experimental-vm-modules` to the `test` script rather than mocking
      around real PDF parsing in tests.
- [ ] `code-review` and `web-design-guidelines` run against this document and the PRD as spec —
      not run as a separate pass this round
- [x] The OCR/scanned-PDF gap (§3) is implemented as a clear `status: 'error'`, `errorReason: 'No
      readable text found in this file.'` outcome (verified by test) rather than a silent
      forever-processing state; a dedicated OCR fallback remains a fast-follow, not built this
      phase
- [x] §9's shared-badge, shared-scoping, and shared-provider-extension decisions verified against
      Phase 5's actual implementation — `<ProcessingStatusBadge>` is imported by both phases'
      list pages unmodified, `requireBucketMembership` is the one shared helper both `file.service.ts`
      and `chat-search.service.ts`/`import.service.ts` call, and `LlmProvider.rerank()` /
      `answerWithContext()` both extend the single provider interface rather than forking clients
