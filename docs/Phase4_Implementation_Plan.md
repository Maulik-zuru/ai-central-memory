# Phase 4 Implementation Plan — Smart Memory & Context Retrieval Engine

**Source documents:** `Product_Requirements.md` (§7.8's `US-ADV-01`, the Smart Memory glossary
entry in §3), `Backend_Plan.md` (Phase 4), `Frontend_Plan.md` (Phase 4)
**Companion document:** `Phase3_Implementation_Plan.md` — this phase's retrieval engine is
bucket-scoped and must reuse Phase 3's RBAC middleware rather than inventing its own
authorization story. See §3 and §9 below for the exact seams, and §9 for a gap in Phase 2/3's
scoping that this phase's design surfaced.

---

## 1. Objective

> Given 100+ seeded memories, a sample conversation retrieves a small, relevant subset and the
> token count is measurably reduced vs. sending everything (backend exit criteria). Turning Smart
> Mode on visibly changes what would be injected, and the user can see why (frontend exit
> criteria).

This is the product's core differentiator per the PRD, and the part every later phase (Ask in
Phase 7, Quick Inject in Phase 8) actually calls — get the interface wrong here and two future
phases inherit the mistake.

## 2. In scope / out of scope

**In scope**
- Categorization: assign every memory to a stable category, reusing an existing one when the
  content matches rather than inventing near-duplicate labels every time
- Intent understanding: given a conversation snippet, determine which categories are relevant
- Retrieval + ranking: similarity + recency + category match → an ordered, budget-bounded subset
- Token-budgeted context assembly, exposed as a preview endpoint
- A first cache layer for repeated similar queries
- Frontend: Smart Mode toggle, a context-preview surface, a token-savings indicator, an editable
  category browser

**Explicitly out of scope this phase**
- There is no live AI conversation to inject into yet (that's Phase 8's browser extension, and
  Phase 7's Ask). The preview endpoint and its UI work against a **user-supplied sample
  snippet**, not a real in-flight chat — the plumbing is identical either way (Phase 7/8 call the
  same preview logic with a real snippet instead of a pasted one), so this isn't a shortcut that
  gets rebuilt later, just a smaller surface to test it through today.
- Real Redis-backed caching — see §4, same call as Phase 2's job-queue decision.
- Per-plan feature gating (`US-ADV-01` is Core-basic/Pro-full per the PRD's scope table) — Phase
  10 owns enforcement; this phase builds one implementation and lets Phase 10 decide what Core
  sees vs. Pro.

## 3. Dependency on Phase 3

Every retrieval query in this phase is bucket-scoped:
- Candidates for retrieval/preview are memories in buckets where the caller has at least `viewer`
  role — enforced by calling Phase 3's `requireBucketRole('viewer')`, not a parallel check.
- The preview endpoint accepts an optional `bucketId`; omitted means "every bucket the caller can
  see," exactly matching how `GET /api/memories` (Phase 3 §6.4) already treats an omitted filter.
- If Phase 3 hasn't shipped when this phase starts, the minimum viable stand-in is: every memory
  belongs to its creator's default bucket (true today, per Phase 2), so retrieval can scope by
  `userId` alone as a temporary equivalent — but the query must be written against
  `requireBucketRole`, not `userId ===`, from the start, so removing the stand-in later is
  deleting a fallback, not rewriting the query.

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| `CacheProvider` interface | Backend_Plan.md calls for "a caching layer for repeated similar queries (Redis)" | Same call as Phase 2's job-queue decision: no real Redis yet, since nothing else in the running system needs it either. An in-memory LRU (bounded size, TTL per entry) implements the same `get`/`set`/`invalidate` interface a Redis-backed one would — swapping later is a constructor change, not a rewrite. Documented as a known simplification, same as Phase 2's embedding pipeline. |
| Real tokenizer | Token-budgeted assembly needs actual token counts, not a guess, or the "reduced by X%" claim (`US-ADV-01` AC: "the savings figure shown is accurate to what was actually sent") is fabricated | Add a real tokenizer library (e.g. `gpt-tokenizer` — pure JS, no native build step, no network call). Unlike the LLM/embedding providers, this needs no stub: it's a deterministic local computation either way, dev and prod alike. |
| `LlmProvider` extended | Categorization needs a label; intent classification needs a relevance judgment | Add `suggestCategoryLabel(content: string): Promise<string>` and reuse the *existing* `embed()` for both category-centroid matching and intent classification (see §5.2) — no separate "intent" API call needed even in the real-provider path, since embedding similarity against category centroids **is** the intent signal. Fewer moving parts than a dedicated classification call, and the stub path (Phase 2's deterministic hash embedding) works identically for this without any new stub logic. |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model Category {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  label     String
  centroid  Unsupported("vector(1536)")?
  memoryCount Int    @default(0)
  createdAt DateTime @default(now())
  memories  Memory[]

  @@unique([userId, label])
  @@index([userId])
}
```

`Memory` gains `categoryId String?` (nullable — a brand-new memory has no category until the
async categorization step runs, same lifecycle as `embedding`).

`User` gains `smartMemoryEnabled Boolean @default(true)` — a single well-known flag, not folded
into the existing `autoCapture` JSON blob, since it's a distinct on/off switch with its own
semantics rather than a per-platform map.

**Categories are scoped per-account (creator), not per-bucket.** Per `Phase3_Implementation_Plan.md`
§9: a memory's category is a property of its content, not of where it's organized. Concretely, if
Alice's memory lives in a bucket shared with Bob, the memory keeps Alice's category label — Bob
can see it (categories are informational, not an access boundary) but can't rename it unless he
also has edit rights on the *memory* itself (Phase 3's existing `editor`+ check), not some
separate category-ownership rule.

### 5.2 Services

- **`categorization.service.ts`** — appended as a fourth step in Phase 2's existing fire-and-forget
  embedding chain (`embed → duplicate-detect → stale-detect → categorize`), not a separate
  trigger: given a memory's now-written embedding, find the nearest `Category` centroid (same
  `<=>` raw-query pattern as `duplicate-detection.service.ts`) for that user. Within a similarity
  threshold, assign to it and update the centroid as a running average
  (`newCentroid = oldCentroid + (embedding - oldCentroid) / (memoryCount + 1)`, computed in the
  same `$executeRaw` update as the count increment, so it's one atomic write, not read-modify-write
  from the application layer). Outside the threshold, create a new `Category` — label via
  `LlmProvider.suggestCategoryLabel()` (stub: a short heuristic, e.g. the most frequent
  non-stopword in the memory, capitalized — good enough to exercise "a label gets created and
  reused," not good enough to ship as the real labeling logic without a real LLM configured).
- **`retrieval.service.ts`** — `buildContext(userId, { snippet, bucketId? })`:
  1. Resolve the candidate set: memories in scope (bucket-filtered per §3), `status: 'active'`.
  2. Embed the snippet (same `LlmProvider.embed()` Phase 2 already has).
  3. Score every candidate: `score = 0.6 * cosineSimilarity + 0.25 * recencyDecay + 0.15 *
     categoryMatchBonus`, where `recencyDecay = exp(-ageInDays / 30)` and `categoryMatchBonus` is
     `1` if the candidate's category is among the top-3 categories by centroid-similarity to the
     snippet embedding, else `0`. **These weights and the 30-day half-life are a first calibrated
     guess** (no existing PRD/plan value to inherit, unlike Phase 2's thresholds which at least had
     an open question flagged) — documented here as the concrete starting point Phase 12's load
     testing and real usage should tune, not as a settled constant.
  4. Sort by score descending; greedily add to the context until the next candidate would exceed
     the token budget (default 2000 tokens, configurable), counted via the real tokenizer (§4).
  5. Return the selected memories, their categories, the actual token count, and — critically —
     the token count of "every active memory in scope" so the frontend's savings percentage is
     `1 - (actual / everything)`, computed from two real counts, never a canned "~86%."
  - Reads through `CacheProvider`, keyed on `(userId, bucketId, hash(snippet))`, short TTL (60s) —
    long enough to dedupe rapid repeated calls (e.g. a UI re-render triggering the same preview
    twice), short enough that a newly created memory shows up in the next real preview quickly.
- **`category.service.ts`** — `list()`, `rename()` (label only — never touches `centroid` or
  `memoryCount`, so renaming can't accidentally break future categorization for that cluster).

### 5.3 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/context/preview` (`{ snippet, bucketId? }`) | `US-ADV-01` |
| GET | `/api/categories` | `US-ADV-01` (category browser) |
| PATCH | `/api/categories/:id` (rename) | `US-ADV-01` |
| PATCH | `/api/account/smart-memory` (`{ enabled: boolean }`) | `US-ADV-01` (Smart Mode toggle) |

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. A memory similar to an existing category's centroid is assigned to it; a memory unlike any
   existing category creates a new one.
2. Categorization is stable: seeding several similar memories in sequence reuses the same
   `categoryId` rather than fragmenting into near-duplicate categories (mirrors Phase 2's
   duplicate-detection test shape — same calibration technique, different target).
3. Renaming a category doesn't change its `centroid`, `memoryCount`, or any memory's `categoryId`.
4. With 100+ seeded memories in scope, a preview call returns strictly fewer memories (and a lower
   token count) than "every active memory in scope" — the backend exit criteria, made concrete.
5. Turning Smart Mode off returns the full unfiltered set from the same endpoint (so the frontend
   toggle has one real state to reflect, not a client-side-only filter of an already-filtered
   response).
6. The returned token count matches an independent tokenizer count of the actual returned content
   — not a separately-estimated number that could drift from what's really "sent."
7. A preview scoped to a bucket the caller isn't at least a viewer on returns 403 — proves the
   Phase 3 middleware is actually being called, not reimplemented.
8. Two identical preview calls within the cache TTL hit the cache (assert the underlying scoring
   query ran once, via a call-count spy on `retrieval.service`), a third after TTL expiry runs
   fresh.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

Given 100+ seeded memories, a sample conversation retrieves a small, relevant subset and the
token count is measurably reduced vs. sending everything.

---

## 6. Frontend plan

### 6.1 Where this lives

Frontend_Plan.md doesn't pin down a route, since there's no live chat surface to attach a preview
to yet (that's Phase 8). Placement decision: a new **Settings → Smart Memory** tab, alongside
Phase 1's Account/API Keys/Sessions/Privacy tabs, containing:
- The Smart Mode toggle
- The category browser
- A "Try it" panel: a textarea for a sample snippet, a bucket selector (reusing Phase 3's
  `<BucketFilter>`), and a "Preview" button that calls the same endpoint Phase 7/8 will call for
  real — so this isn't throwaway UI, it's the first caller of a contract three later phases share.

### 6.2 Screens & components

- **Smart Mode toggle** — same `Toggle` pattern Phase 1's Privacy tab already established for
  auto-capture, applied to `PATCH /api/account/smart-memory`.
- **Category browser** — a list of categories with memory counts (`Badge` showing count) and
  inline rename (click label → input, matching the memory detail page's inline-edit pattern from
  Phase 2).
- **Context preview panel**: shows the exact memories that would be injected (each rendered with
  Phase 2's existing `MemoryRow`-style preview, not a new list component), their categories as
  badges, and — when Smart Mode is off — a clear "showing everything, unfiltered" state rather
  than silently reusing the last filtered result (`US-ADV-01`'s third Given/When/Then).
- **Token-savings indicator**: `"Reduced from {everythingTokens} to {actualTokens} tokens
  (~{percent}% smaller)"`, computed from the two real numbers the endpoint returns — never a
  hardcoded example percentage.

### 6.3 Data fetching

- `usePreview({ snippet, bucketId })` — a mutation (not a query — it's explicitly triggered by the
  "Preview" button, not fetched on every keystroke), following the same `useMutation` shape as
  Phase 2's create/update memory calls.
- `useCategories()`, `useRenameCategory()` — same list/invalidate pattern as Phase 1's API keys.
- `useSmartMemoryToggle()` — same shape as Phase 1's `updateAutoCapture`.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

Turning Smart Mode on visibly changes what would be injected, and the user can see why.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3, Phase 2 §4, Phase 3 §5) — only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Raw SQL / centroid math | `prisma-client-api` (raw-queries) | The running-average centroid update is a single parameterized `$executeRaw`, not a read-then-write from application code — get the parameterization wrong here and it's the same class of risk as Phase 2's vector queries |
| Module boundaries | `codebase-design` | `CacheProvider` is a third provider seam in the same family as Phase 2's `LlmProvider`/`StorageProvider` — consistency here means a future Redis swap touches one file, not three different ad hoc caching approaches |
| Domain vocabulary | `domain-modeling` | "Category" needs a precise definition before code exists: is it a tag (many-to-many) or a single classification (one category per memory, as designed here)? Getting this wrong after `categoryId` ships as a single foreign key is a schema migration, not a copy change |
| Test-first | `tdd` | The ranking formula and cache behavior are exactly the kind of "looks right, silently wrong" code `tdd` exists for — write "fewer memories than everything" and "cache hit doesn't re-query" as red tests before tuning weights |
| Efficient re-renders | `vercel-react-best-practices` (`rerender-derived-state`, `async-defer-await`) | The preview panel's "everything" vs. "filtered" comparison should derive from one query result, not two separate fetches racing each other |
| Component reuse | `vercel-composition-patterns` | The category browser's inline-rename and the preview panel's memory list should reuse Phase 2's existing row/badge components, not fork new ones — an explicit-variant, not a parallel implementation |
| Visual consistency | `frontend-design`, `ui-ux-pro-max` | A new Settings tab, badges, and a "before/after" token comparison are new shapes — extend the existing identity (cobalt for the active toggle state, mono tags for token counts, matching Phase 2's `.mono-tag` use for ids/timestamps) |
| Accessibility | `web-design-guidelines` | The toggle, inline category rename, and preview panel are all new interactive elements needing keyboard/screen-reader parity, checked before calling this phase done |

## 8. Delivery order (suggested)

1. **Infra:** `CacheProvider` interface + in-memory LRU implementation; add the tokenizer
   dependency
2. **Backend:** `Category`/`Memory.categoryId`/`User.smartMemoryEnabled` migration
3. **Backend:** `categorization.service` appended to the embedding chain, tests first
4. **Backend:** `retrieval.service` (scoring, budget, cache), tests first — depends on Phase 3's
   `requireBucketRole` existing
5. **Backend:** `category.service` + endpoints
6. **Frontend:** Settings → Smart Memory tab: toggle, category browser
7. **Frontend:** context preview panel + token-savings indicator, wired to the real endpoint
8. **Both:** run `code-review` and `web-design-guidelines` against this doc and the PRD; fix
   findings
9. Confirm backend exit criteria with a real 100+-memory seed (not a handful — the claim is
   specifically about behavior at that scale) and frontend exit criteria toggling Smart Mode live

## 9. Gap this phase's design surfaced (for Phase 3, not silently patched here)

Designing bucket-scoped retrieval exposed that Phase 2's duplicate/stale detection
(`duplicate-detection.service.ts`, `stale-detection.service.ts`) is scoped by `userId` alone,
comparing only a user's *own* memories — even after Phase 3 ships sharing, two collaborators
contributing near-identical memories to the same shared bucket would **not** be flagged as
duplicates of each other, only of themselves. This wasn't caught during Phase 3 planning because
Phase 3's own exit criteria don't touch duplicate detection.

**This is scoped as Phase 3 follow-up work, not folded into Phase 4**: duplicate/stale detection
becoming bucket-aware (comparing across all contributors to a shared bucket, not just the memory's
own creator) is a change to Phase 3's domain (bucket membership), not Phase 4's (retrieval
ranking). Recorded here because Phase 4's design is what surfaced it — `Phase3_Implementation_Plan.md`
should be revised to add this to its scope before Phase 3 implementation is considered complete,
rather than this being discovered again mid-build.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Categorization service | §5.2 categorization.service |
| Intent understanding | §5.2 retrieval.service step 2–3 (embedding similarity doubles as intent, §4) |
| Retrieval + ranking | §5.2 retrieval.service step 3 |
| Context assembly with token budgeting | §5.2 retrieval.service step 4, §4 tokenizer |
| Caching layer | §4 CacheProvider, §5.2 retrieval.service cache read |
| US-ADV-01 (preview, token savings, Smart Mode on/off) | §5.3 endpoints, §6.2 preview panel + toggle |

## 11. Definition of done

- [x] All Phase 4 endpoints in §5.3 implemented and covered by tests written per §5.4
      (`tests/smart-memory.test.ts`, 9 tests covering categorization stability, rename isolation,
      the 100+-memory preview reduction, the Smart Mode on/off contract, tokenizer-accuracy, the
      403 on an unauthorized bucket, and cache-hit/no-stale-cache-across-toggle behavior)
- [x] Backend exit criteria (§5.5) demonstrated with a real 100+-memory seed — both in
      `tests/smart-memory.test.ts` (110 seeded memories, `tokenBudget: 500`) and live against the
      running dev server via a scripted browser + API check
- [x] Frontend exit criteria (§6.4) demonstrated live, toggling Smart Mode and observing the
      preview panel change (verified in a real browser: toggling off switches the panel to the
      "showing everything, unfiltered" state on the next preview call)
- [x] Self-review caught and fixed two real bugs during this phase: `apiRateLimit` was mounted
      before each router's `authenticate` middleware ran (so its per-user keying silently fell
      back to shared per-IP limiting for every protected route — fixed by moving the limiter
      inside each router, after `authenticate`), and the context-preview cache key didn't include
      `smartMemoryEnabled`, so toggling Smart Mode and re-running the same snippet could serve a
      stale pre-toggle result until the 60s TTL expired — fixed and covered by a regression test.
      A dedicated `web-design-guidelines` pass was not run separately.
- [x] §9's gap (bucket-aware duplicate/stale detection) was implemented as part of Phase 3 itself
      (see `Phase3_Implementation_Plan.md` §11), not left as a fast-follow
- [x] The ranking weights in §5.2 are logged: `retrieval.service.ts`'s `ContextResult.weights`
      field returns the similarity/recency/category weights and the recency half-life on every
      preview call (surfaced in the API response, not just an internal debug log)
