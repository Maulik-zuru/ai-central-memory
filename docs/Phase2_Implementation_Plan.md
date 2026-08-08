# Phase 2 Implementation Plan — Core Memory System ("The Notebook")

**Source documents:** `Product_Requirements.md` (§7.2, epics `US-MEM-01`…`US-MEM-09`),
`Backend_Plan.md` (Phase 2), `Frontend_Plan.md` (Phase 2), `Phase1_Implementation_Plan.md`
(precedent format + what Phase 1 actually shipped)
**Scope:** the memory notebook — the product's core differentiator. Builds directly on Phase 1's
`User`/`Session`/`ApiKey`/`Subscription` foundation. No buckets yet (Phase 3), no Smart
Memory/retrieval ranking yet (Phase 4) — every memory lives in one implicit "default" bucket this
phase, exactly as Phase 1 left it.

---

## 1. Objective

> Creating two near-duplicate memories produces a duplicate suggestion within seconds; editing a
> memory produces a retrievable version history (backend exit criteria). A user can create, edit,
> merge, and review the history of a memory without leaving this section (frontend exit criteria).

Everything below is scoped to make that statement true and traceable to `US-MEM-01`…`US-MEM-09`.

## 2. In scope / out of scope

**In scope this phase**
- Manual memory creation, edit, delete (`US-MEM-01`, `US-MEM-04`)
- One-click save endpoint — same low-latency contract the extension will call in Phase 8, built
  and tested now even though nothing calls it yet (`US-MEM-02`)
- Automatic capture pipeline with mandatory confirmation step — never silently saved (`US-MEM-03`)
- Image memories — upload, thumbnail, storage (`US-MEM-05`)
- Duplicate detection + merge (`US-MEM-06`)
- Stale-memory detection + review (`US-MEM-07`)
- Version history, append-only (`US-MEM-08`)
- Scalable list/search past 1,000 memories (`US-MEM-09`)

**Explicitly out of scope this phase**
- Buckets, sharing, RBAC — Phase 3. Every memory this phase belongs to one implicit default
  bucket (a single row seeded per user); the schema's `bucketId` foreign key exists now so Phase 3
  is additive, not a migration that touches every `Memory` row twice.
- Smart Memory categorization, retrieval ranking, context-preview — Phase 4. Search this phase is
  plain hybrid (keyword + vector similarity) with no category/token-budget layer on top.
- Real extension/MCP callers of one-click-save — Phase 8. The endpoint is built and tested; it's
  just not reachable from a browser yet.

## 3. Infrastructure gap this phase must close

Phase 1 shipped without most of `Backend_Plan.md` Phase 0's infra because Phase 1 didn't need any
of it. Phase 2 does — the following are prerequisites, not optional polish:

| Gap | Why Phase 2 needs it | Plan |
|---|---|---|
| **pgvector extension** | Duplicate/stale detection and memory search are nearest-neighbor lookups over embeddings | `CREATE EXTENSION IF NOT EXISTS vector;` in a migration; Prisma models the column as `Unsupported("vector(1536)")` since Prisma has no native vector type — all reads/writes to it go through `$queryRaw`/`$executeRaw` (parameterized, per the `prisma-client-api` skill's raw-query safety rule, never string-concatenated) |
| **LLM provider abstraction** | Automatic capture (fact extraction) needs a real LLM call | A single `LlmProvider` interface (`extractMemoryCandidates()`, `embed()`) with an Anthropic-backed implementation and a **deterministic stub implementation** used in tests/CI and whenever no API key is configured — mirrors how Phase 1 stubbed Google OAuth rather than blocking on credentials |
| **Job queue (Redis + BullMQ)** | Embedding generation and capture extraction must not block the request that triggers them | Provision Redis (add to `scripts/setup.mjs`/`SETUP.md` as a Phase 2 prerequisite the same way Postgres was for Phase 1); `memory.embed` and `memory.extract` queues, each with a bounded retry policy |
| **Object storage for images** | Image memories need durable file storage | A `StorageProvider` interface (`put()`, `getUrl()`, `delete()`) with a local-disk implementation for dev (files under `backend/uploads/`, served via a static route) and an S3-compatible implementation gated behind env vars — swapping providers later touches zero callers, per `codebase-design`'s deep-module principle |

None of these are exposed to the frontend directly — they're internal to the backend's memory
module, consistent with Phase 1's pattern of hiding Prisma/bcrypt/JWT details behind a service
layer.

## 4. Skills used, mapped to this phase

Extends the Phase 1 table (`Phase1_Implementation_Plan.md` §3) with what's new this phase.
Everything from Phase 1's table (`nodejs-backend-patterns`, `nodejs-best-practices`, `prisma-cli`,
`prisma-client-api`, `codebase-design`, `domain-modeling`, `tdd`, `code-review`,
`diagnosing-bugs`, `shadcn`, `vercel-composition-patterns`, `vercel-react-best-practices`) still
applies and isn't re-derived here.

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Vector/raw SQL | `prisma-client-api` (raw-queries) | pgvector similarity search bypasses the generated client — every `$queryRaw` call for embeddings must be parameterized, not template-string SQL |
| Domain vocabulary | `domain-modeling` | "Memory" vs "MemoryVersion" vs "MemorySuggestion" vs "duplicate" vs "stale" need precise, shared definitions before schema work — get this wrong and the suggestion-inbox UI and the detection service will disagree about what a "duplicate" even is |
| Module boundaries | `codebase-design` | `LlmProvider` and `StorageProvider` are exactly the kind of seam this skill is for: swappable implementations behind a small interface, so a real API key or a real S3 bucket can drop in later without touching `memory.service.ts` |
| Test-first | `tdd` | Duplicate/stale detection is probabilistic (embedding similarity thresholds) — writing the acceptance test first (`US-MEM-06`/`07`'s Given/When/Then) forces a concrete first threshold value instead of "we'll tune it later and never do" |
| List performance | `vercel-react-best-practices` (`rendering-content-visibility`, `rerender-*`) | The memory list must stay responsive past 1,000 rows (`US-MEM-09`) — virtualization and avoiding unnecessary re-renders on every keystroke in the search box are the two concrete risks |
| Component structure | `vercel-composition-patterns` | The suggestion inbox has three card types (duplicate/stale/new) with different actions — model as explicit variant components, not one card with five boolean props |
| Visual consistency | `frontend-design`, `ui-ux-pro-max` | Phase 2 introduces real content-heavy surfaces (list, diff view, image lightbox) for the first time — extend the Phase-1 "notebook" identity (paper/ink/cobalt, serif headings, mono for ids/timestamps) rather than drifting to generic list/table styling per screen |
| Accessibility | `web-design-guidelines` | New interactive surfaces this phase — image upload, diff view, inline approve/dismiss/merge actions — are exactly what this skill's compliance review targets; run it against the suggestion inbox and version-history diff before calling Phase 2 done |

## 5. Backend plan

### 5.1 Data model additions (Prisma)

```prisma
model Bucket {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  memories  Memory[]

  @@index([userId])
}

model Memory {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  bucketId    String
  bucket      Bucket    @relation(fields: [bucketId], references: [id])
  type        String    // "text" | "image"
  content     String
  imageUrl    String?
  source      String    // "manual" | "one_click" | "auto"
  status      String    @default("active") // "active" | "stale" | "merged" | "deleted"
  embedding   Unsupported("vector(1536)")?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  versions    MemoryVersion[]

  @@index([userId, status])
  @@index([bucketId])
}

model MemoryVersion {
  id           String   @id @default(cuid())
  memoryId     String
  memory       Memory   @relation(fields: [memoryId], references: [id], onDelete: Cascade)
  content      String
  changedBy    String   // userId, or "system" for merges
  changeType   String   // "create" | "edit" | "merge"
  createdAt    DateTime @default(now())

  @@index([memoryId])
}

model MemorySuggestion {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       String    // "duplicate" | "stale" | "capture"
  memoryIdA  String
  memoryIdB  String?   // null for a "capture" suggestion (draft, not yet a real Memory)
  draftContent String? // populated only for "capture" suggestions awaiting confirmation
  status     String    @default("pending") // "pending" | "approved" | "dismissed"
  createdAt  DateTime  @default(now())

  @@index([userId, status])
}
```

Notes:
- `Memory.embedding` uses `Unsupported("vector(1536)")` — Prisma has no native vector type; every
  query touching it is a raw query (see §5.3).
- `Bucket` is introduced here, one migration early relative to `Backend_Plan.md`'s own Phase 3
  placement, specifically so `Memory.bucketId` is never-null from day one. The alternative —
  adding `bucketId` in Phase 3 — means a backfill migration touching every existing memory row.
  Phase 3 only adds `BucketMember`/sharing on top of a model that already exists.
- `MemorySuggestion` covers all three suggestion types (`US-MEM-03`, `06`, `07`) in one table
  rather than three, since the suggestion inbox UI (`Frontend_Plan.md` Phase 2) renders them as one
  filtered list — one table matches one query, no UNION needed.

### 5.2 Services

- **`memory.service.ts`** — `create()`, `update()` (writes a `MemoryVersion` on every change,
  never overwrites in place), `delete()` (soft: `status = "deleted"`, excluded from all queries
  and retrieval immediately per `US-MEM-04` AC), `merge()` (combines two memories' content, keeps
  both version lineages under the surviving record), `list()` (paginated/cursor-based, not
  offset — offset pagination degrades past a few thousand rows, which `US-MEM-09` explicitly
  targets).
- **`capture.service.ts`** — wraps `LlmProvider.extractMemoryCandidates()`; on a conversation
  snippet, produces a `MemorySuggestion` of type `"capture"` with `draftContent` populated, never
  a `Memory` row directly (`US-MEM-03` AC: shown for approval before persisted).
- **`suggestion.service.ts`** — `approve()`/`dismiss()`/`listPending()`. Approving a `"capture"`
  suggestion calls `memory.service.create()`; approving a `"duplicate"` calls `merge()`; approving
  a `"stale"` sets the older memory's `status = "stale"` (never hard-deleted, per `US-MEM-07` AC).
  Dismissing a duplicate/stale pair records it so the identical pair is never re-flagged (a
  `dismissedPairs` lookup keyed by the sorted `(memoryIdA, memoryIdB)` tuple).
- **`embedding.service.ts`** — enqueues a `memory.embed` job on create/update; the job calls
  `LlmProvider.embed()` and writes the vector via `$executeRaw`. Async so it never blocks the
  save response (`US-MEM-01` AC: "embedding generation is queued automatically, not blocking the
  save" — already written as a Phase 1-style acceptance criterion in the PRD, now actually built).
- **`duplicate-detection.service.ts`** — after an embedding job completes, runs a nearest-neighbor
  query (`$queryRaw` with pgvector's `<=>` cosine-distance operator, parameterized) against the
  same user's other active memories; above a configured threshold, creates a `"duplicate"`
  suggestion linking both.
- **`stale-detection.service.ts`** — heuristic pass (embedding similarity above a *lower* bound
  than the duplicate threshold, combined with a simple contradiction check — e.g. differing
  values extracted for the same entity/slot by the LLM) creates a `"stale"` suggestion flagging
  the older memory.
- **`storage.service.ts`** — the `StorageProvider` interface from §3, used only by
  `memory.service.ts` for image memories.

### 5.3 On raw SQL for vectors (per `prisma-client-api`)

```typescript
// duplicate-detection.service.ts — nearest-neighbor lookup, parameterized, never string-built.
const matches = await prisma.$queryRaw<{ id: string; distance: number }[]>`
  SELECT id, embedding <=> ${embeddingLiteral}::vector AS distance
  FROM "Memory"
  WHERE "userId" = ${userId} AND status = 'active' AND id != ${memoryId}
  ORDER BY distance ASC
  LIMIT 5
`;
```
`embeddingLiteral` is built once from a `number[]` via a small helper (`toVectorLiteral()`), never
by interpolating user-controlled strings directly into the query.

### 5.4 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/memories` | `US-MEM-01` |
| POST | `/api/memories/one-click` | `US-MEM-02` |
| GET | `/api/memories` (cursor-paginated, `?q=` search) | `US-MEM-09` |
| GET | `/api/memories/:id` | detail panel |
| PATCH | `/api/memories/:id` | `US-MEM-04` |
| DELETE | `/api/memories/:id` | `US-MEM-04` |
| GET | `/api/memories/:id/versions` | `US-MEM-08` |
| POST | `/api/memories/image` (multipart) | `US-MEM-05` |
| POST | `/api/capture` (conversation snippet → draft suggestion) | `US-MEM-03` |
| GET | `/api/suggestions?status=pending` | `US-MEM-03`, `06`, `07` |
| POST | `/api/suggestions/:id/approve` | `US-MEM-03`, `06`, `07` |
| POST | `/api/suggestions/:id/dismiss` | `US-MEM-03`, `06`, `07` |
| POST | `/api/suggestions/:id/merge` | `US-MEM-06` (merge is its own action, not a generic approve, since it needs no `memoryIdB` disambiguation the other two don't) |

### 5.5 Testing (`tdd`) — acceptance criteria as red tests first

1. Creating a memory with empty content is rejected (`US-MEM-01`).
2. A memory's embedding job is enqueued, not awaited, by the create call — the HTTP response
   returns before the job completes (`US-MEM-01`).
3. One-click save returns in-flow with the exact highlighted text, no LLM rewrite applied
   (`US-MEM-02`).
4. A capture call produces a pending suggestion, never a live `Memory` row (`US-MEM-03`).
5. Dismissing a capture suggestion does not re-suggest the identical snippet in the same session
   (`US-MEM-03`).
6. Editing a memory produces a new `MemoryVersion`; the memory's own content is never mutated
   without one (`US-MEM-04`, `08`).
7. Deleting a memory excludes it from `GET /api/memories` and from the (not-yet-built, but the
   interface must already exclude deleted rows) retrieval path immediately (`US-MEM-04`).
8. Two memories seeded with near-identical embeddings produce exactly one `"duplicate"`
   suggestion linking both, without blocking either save (`US-MEM-06`).
9. Approving a duplicate suggestion merges the two memories and both original version histories
   survive under the merged record (`US-MEM-06`).
10. Dismissing a duplicate suggestion leaves both memories separate and the same pair is never
    flagged again (`US-MEM-06`).
11. A contradicting new memory flags the older one as a `"stale"` suggestion rather than
    overwriting it silently; approving marks it inactive, not deleted (`US-MEM-07`).
12. Seeding 1,000+ memories, `GET /api/memories` with cursor pagination stays under a fixed
    latency budget and returns consistent pages (no duplicate/skipped rows across pages)
    (`US-MEM-09`).

### 5.6 Backend exit criteria (unchanged from `Backend_Plan.md`)

Creating two near-duplicate memories produces a duplicate suggestion within seconds; editing a
memory produces a retrievable version history.

---

## 6. Frontend plan

### 6.1 Visual continuity

No new design-system pass this phase — extend Phase 1's tokens (`--primary` cobalt,
`--font-display` serif headings, `.mono-tag` for ids/timestamps, `--shadow-card`/`--shadow-raised`)
rather than introducing new colors or type. The one deliberate new pattern: **diff view** for
version history uses the existing `success`/`destructive` tokens for added/removed text spans, so
it reads as "the same design system showing a diff," not a bolted-on component from elsewhere.

### 6.2 Screens & components

- **Memory list** (`/dashboard/memories`, replacing Phase 1's empty state): search bar, virtualized
  list (per `vercel-react-best-practices`'s `rendering-content-visibility`), each row shows a
  content preview, a `.mono-tag` relative timestamp, and a source badge (manual/one-click/auto).
- **Create/edit modal** — shadcn `Dialog` + `Textarea`, reusing Phase 1's `Dialog` primitive.
  Optimistic UI: the new memory appears at the top of the list immediately, embedding status shown
  as a small "indexing…" tag that clears when the async job completes (polled or via the existing
  TanStack Query cache invalidation pattern from Phase 1 — no new data-fetching pattern needed).
- **Image memory** — upload via drag-drop or file picker, thumbnail grid, lightbox on click.
- **Memory detail panel** — slide-over or dedicated route showing full content, bucket (Phase 3
  placeholder: always "Personal" this phase), and the version history timeline.
- **Version history timeline + diff view** (`US-MEM-08`): a vertical timeline of versions with
  timestamps (`.mono-tag`); selecting two versions shows a line-level diff, added spans in
  `success`-tinted background, removed spans in `destructive`-tinted background with strikethrough.
- **Suggestion inbox** (`US-MEM-03`, `06`, `07`): three explicit card **variant components** —
  `CaptureCard`, `DuplicateCard`, `StaleCard` — per `vercel-composition-patterns`
  (`patterns-explicit-variants`), not one `SuggestionCard` branching on a `type` prop with
  different action sets. Each renders its own Approve/Dismiss(/Merge) actions.

### 6.3 Data fetching

- `useMemories({ q, cursor })` — TanStack Query with `keepPreviousData` so search-as-you-type
  doesn't flash empty states between keystrokes.
- `useMemoryVersions(memoryId)`, `useSuggestions({ status: "pending" })` — same pattern as
  Phase 1's `useApiKeys`/`useSessions`.
- Mutations (`create`, `update`, `delete`, `approveSuggestion`, `dismissSuggestion`,
  `mergeSuggestion`) invalidate the relevant list query on success — the exact pattern Phase 1's
  API-key revoke already established, reused rather than re-invented.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A user can create, edit, merge, and review the history of a memory without leaving this section.

---

## 7. Delivery order (suggested)

1. **Infra:** enable pgvector extension; provision Redis; scaffold `LlmProvider` and
   `StorageProvider` interfaces with stub implementations (§3)
2. **Backend:** schema migration (`Bucket`, `Memory`, `MemoryVersion`, `MemorySuggestion`) —
   seed one default `Bucket` per existing Phase-1 user in the same migration
3. **Backend:** `memory.service` CRUD + versioning, tests first (`tdd`)
4. **Backend:** `embedding.service` + job queue wiring, `duplicate-detection.service`,
   `stale-detection.service`, tests first
5. **Backend:** `capture.service` + `suggestion.service`, tests first
6. **Backend:** image upload endpoint + `storage.service` (local-disk provider)
7. **Frontend:** memory list with virtualization + search, replacing the Phase 1 empty state
8. **Frontend:** create/edit modal, image upload + lightbox
9. **Frontend:** version history timeline + diff view
10. **Frontend:** suggestion inbox (three card variants)
11. **Both:** run `code-review` and `web-design-guidelines` against this doc and the PRD as spec;
    fix findings
12. Confirm both exit criteria (§5.6, §6.4) end-to-end before calling Phase 2 done

## 8. Traceability checklist

| Story | Covered by |
|---|---|
| US-MEM-01 | §5.1 Memory model, §5.2 memory.service.create, §5.4 POST /api/memories, §6.2 create modal |
| US-MEM-02 | §5.4 POST /api/memories/one-click, §5.5 test 3 |
| US-MEM-03 | §5.1 MemorySuggestion (type=capture), §5.2 capture.service, §6.2 suggestion inbox (CaptureCard) |
| US-MEM-04 | §5.2 memory.service.update/delete (versioned, soft-delete), §6.2 create/edit modal |
| US-MEM-05 | §3 StorageProvider, §5.4 POST /api/memories/image, §6.2 image upload + lightbox |
| US-MEM-06 | §5.2 duplicate-detection.service + suggestion.service.merge, §6.2 DuplicateCard |
| US-MEM-07 | §5.2 stale-detection.service, §6.2 StaleCard |
| US-MEM-08 | §5.1 MemoryVersion, §6.2 version history timeline + diff view |
| US-MEM-09 | §5.2 cursor-based list(), §6.2 virtualized list |

## 9. Definition of done

- [ ] All Phase 2 endpoints in §5.4 implemented and covered by tests written per §5.5
- [ ] pgvector extension enabled and duplicate/stale detection run against real embeddings (stub
      or real `LlmProvider`), not mocked at the SQL layer
- [ ] Backend exit criteria (§5.6) demonstrated against a real staging deploy
- [ ] Frontend exit criteria (§6.4) demonstrated in a browser with 1,000+ seeded memories, not
      just a handful — `US-MEM-09`'s scale claim is unverified until this is done with real volume
- [ ] `code-review` and `web-design-guidelines` run against this document and the PRD as spec,
      findings resolved or explicitly deferred with a reason
- [ ] Every out-of-scope item in §2 is a visible, honest state in the UI (e.g. bucket always shows
      "Personal"), not a broken affordance
- [ ] `SETUP.md`/`scripts/setup.mjs` updated to provision Redis alongside Postgres, so Phase 2
      isn't only runnable in an environment someone happened to configure by hand

## 10. Implementation notes (post-build)

What actually shipped, and where it deviated from this plan:

- **No real job queue.** Redis/BullMQ was **not** added. `embedding.service.ts` instead runs as a
  fire-and-forget `void` call right after the DB write — the caller never awaits it, so the
  behavioral requirement ("queued automatically, not blocking the save") holds, but there's no
  retry policy, no dead-letter handling, and it doesn't survive a process restart mid-job. The
  function is deliberately job-shaped (one memory in, no return value) so swapping in a real queue
  later is a one-line change at the call site, not a rewrite. `scripts/setup.sh`/`setup.ps1` were
  **not** updated to provision Redis, since nothing in the running system uses it yet — doing so
  now would have been installing infrastructure to match a claim rather than a need.
- **pgvector** ended up genuinely required (not just planned) — `scripts/setup.sh` was updated to
  install it via apt/dnf/pacman/Homebrew alongside Postgres; `setup.ps1` checks for it and points
  to manual installation steps, since there's no Windows package manager entry for it.
- **LLM provider**: both a deterministic stub (feature-hashing embedding + sentence-split
  extraction, used whenever no API key is configured — dev, tests, CI) and real
  Anthropic/OpenAI-backed implementations exist behind the same `LlmProvider` interface, exactly
  as planned. The stub is what all 35 backend tests run against.
- **Duplicate/stale thresholds** — `Product_Requirements.md` §10 flagged these as an open question
  needing "a concrete first value." Resolved here: cosine distance ≤ 0.15 = duplicate, 0.15–0.55 =
  stale-candidate, calibrated empirically against the stub embedding provider (see
  `duplicate-detection.service.ts`'s comment for the actual test sentence pairs and distances).
  These numbers are specific to the stub's feature-hashing behavior and will need
  re-calibration once a real embedding model is wired in — cosine distances from a real model
  don't have the same distribution as a bag-of-words hash.
- **Storage**: local-disk only, as planned — no S3 implementation was written (the interface
  supports adding one without touching `memory.service.ts`).
- Everything else — schema, endpoints, versioning semantics, merge semantics, the frontend
  surfaces — matches this plan as written.
