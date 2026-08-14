# MemoryPlugin Gap Analysis — What's Actually Missing

**Date:** 2026-08-10
**Branch:** `claude/memory-plugin-gaps-report-w2koa4` · **HEAD audited:** `161bdb5`
**Inputs:**
- `MemoryPlugin_Feature_Research.md` — live audit of the real MemoryPlugin product (help.memoryplugin.com), read 2026-08-10
- `Product_Requirements.md`, `Frontend_Plan.md`, `Backend_Plan.md` — this repo's own spec (identical to `docs/`)
- `docs/Requirements_Conformance_Report.md` — this repo's prior audit, dated 2026-08-09, HEAD `cd38a87`
- The actual codebase, re-checked line-by-line for every claim below (not the plan documents, not the prior report's word)

## 0. What this document is

Two audits already exist and this one does not repeat them wholesale:

1. **`Requirements_Conformance_Report.md`** already checked all 59 `US-*` stories against the code as
   of `cd38a87` and found 45 Met / 8 Partial / 6 Not built. Two commits have landed since
   (`5f8c99a` extension pairing fix, `161bdb5` add OpenRouter as an LLM provider) — neither touches
   any of that report's open items. **§1 below re-confirms the still-open ones stayed open** rather
   than re-deriving them from scratch.
2. **`MemoryPlugin_Feature_Research.md`** is new: a page-by-page audit of the real competing product,
   ending in a §4 table of 10 corrections to `Product_Requirements.md` — places where our spec
   under-specifies or mis-specifies the mechanism the real product actually uses. **§2 is the new
   work this report adds**: each of those 10 corrections, checked directly against this codebase,
   with file:line evidence, to answer "do we already build the *real* mechanism, or only the
   under-specified one our own spec describes?"

The honest answer, ahead of the detail: **none of the 10 corrected mechanisms exist in the codebase
today.** In every case the code matches the *old, looser* wording of `Product_Requirements.md`, not
the corrected, more specific behavior the research doc says the real product actually implements.
That is expected — the corrections were written today, one commit after the last code change — but
it means all 10 are net-new scope, not partially-done work.

---

## 1. Still-open from the prior audit (unchanged since `cd38a87`)

Re-verified against current `HEAD`; nothing here has moved:

| Story | Priority | Gap | Still true? |
|---|---|---|---|
| `US-INT-01` | Must | Extension onboarding walkthrough — `background/index.ts:83` sets `onboardingPending: true`, nothing reads it | **Yes** — confirmed, still no reader anywhere in `extension/src` |
| `US-ORG-01` | Must | Bucket deletion refuses (blocks non-empty buckets) instead of asking move-vs-delete | **Yes** — no `strategy` parameter exists in `bucket.service.ts`/`bucket.routes.ts` |
| `US-MEM-09` / `US-ARC-04` | Should | API paginates, UI doesn't — memory list fixed at `limit: 50`, transcript fixed at `limit: 100` | **Yes** — `dashboard/memories/page.tsx:26` still hardcodes `limit: 50`, no infinite scroll |
| `US-ARC-02` | Must | No automatic sync — import is upload-only, no scheduled job, no cancel/resume | **Yes**, see §2.5 below for a fuller re-read of this exact question |
| `US-ACC-05` | Must | Export has no completion notification, in-app polling only | **Yes**, unchanged |
| `US-SEC-01` | Must | Privacy page asserts at-rest encryption no deployment backs up (no infra exists yet) | **Yes**, unchanged |
| `US-INT-03/04/05/06/08` | Must/Should/Could | MCP, Custom GPT, TypingMind, public API docs, Agent Skills install — all not built | **Yes**, see §2.6/§2.7 — re-confirmed absent, and the corrected two-mode MCP spec is *additional* undone scope on top of the plain absence |
| NFR: async job retry/dead-letter | — | `job-runner.provider.ts` has no retry, no dead-letter | **Yes**, unchanged |

Full detail, evidence, and fix estimates for each of these are in `Requirements_Conformance_Report.md`
§4 and are not repeated here. Nothing changed their status.

---

## 2. New gaps: the real mechanism vs. what's built (from `MemoryPlugin_Feature_Research.md` §4)

Each subsection: **what the old spec said** → **what the real product does** → **what the code
actually does today** → **verdict**.

### 2.1 `US-ORG-04` — Shared bucket roles: two roles vs. three

- **Old spec:** Viewer / Editor, two roles.
- **Real product:** three roles — Viewer (read-only), **Contributor** (can add, can only edit/delete
  what *they themselves* added — this is the default role on invite), Editor (can add, can edit/delete
  *anyone's* content). Only the owner can rename/delete the bucket, manage membership, or re-run
  categorization.
- **Code today:** exactly two invitable roles, ranked `viewer: 0, editor: 1, owner: 2`
  (`backend/src/shared/bucketAccess.ts:6-10`), stored as a plain string (`schema.prisma:135,150`).
  Owner-only gating is correctly enforced for rename/delete/invite/role-change/remove-member
  (`bucket.routes.ts:15-27`, all via `requireBucketRole('owner')`) — **except** re-running
  categorization, which is gated to `role: { in: ['editor', 'owner'] }`
  (`category.service.ts:27`), so any editor — not just the owner — can trigger it today.
  Attribution (`Memory.userId`, `MemoryVersion.changedBy`) is tracked in schema, but
  `memory.service.ts:26-28` states outright, in a comment, that edit rights are governed purely by
  bucket role and never by who created the content — an editor can edit/delete the owner's own
  memories, confirmed by test (`bucket.test.ts:179-198`). There is no "Contributor" string anywhere in
  backend or frontend code (grep-confirmed), and the frontend's invite dialog hardcodes exactly
  `"editor" | "viewer"` (`manage-members-dialog.tsx:27,76-115`).
- **Verdict: Not built.** This needs a schema change (`ROLE_RANK` gains a `contributor` tier between
  viewer and editor), a `requireAccess` check that compares `memory.userId` against the caller when
  the caller's role is `contributor`, a `category.service.ts:27` fix to owner-only, and a frontend
  three-way role selector. Medium-sized: touches the permission core, not just a new field.

### 2.2 `US-MEM-06` / `US-MEM-07` — Memory Suggestions: two flows vs. one unified feature

- **Old spec:** two separate stories — duplicate detection+merge, and stale detection+mark-inactive.
- **Real product:** one feature, three operation types, each an accept/reject card — **Remove**
  (duplicate), **Combine** (merge N related memories into one), **Update** (rewrite a stale/unclear
  memory's *content*, not just deactivate the old one). Skips any memory over 10,000 tokens during
  analysis.
- **Code today:** genuinely two independent services (`duplicate-detection.service.ts`,
  `stale-detection.service.ts`), two suggestion types only (`"duplicate" | "stale" | "capture"` on
  `MemorySuggestion.type`, `schema.prisma:202`), two separate frontend card components
  (`DuplicateCard`, `StaleCard`, `suggestion-cards.tsx:66,89`). Merge is strictly pairwise —
  `memoryService.merge(userId, keepId, mergeId)` (`memory.service.ts:163-185`) takes exactly two IDs;
  `MemorySuggestion` has only `memoryIdA`/`memoryIdB` columns (`schema.prisma:203-204`), no array, no
  3+-way combine path. Staleness has no rewrite path at all — approving a stale suggestion only sets
  `status: 'stale'` on the old memory (`suggestion.service.ts:65-70`); the UI button literally says
  "Mark old one inactive" (`suggestion-cards.tsx:111`). No token-size skip exists anywhere — the only
  length limit found is an unrelated 4,000-*character* storage cap on memory content
  (`memory.types.ts:4,9`), not a 10,000-*token* analysis-skip. (Accept-gated, zero-auto-apply — the one
  part of the old design that already matches the real product — is confirmed correct and doesn't
  need rework.)
- **Verdict: Not built.** Three separate gaps bundled as one correction: (a) N-way Combine instead of
  pairwise merge, (b) a genuine content-rewriting Update operation for staleness, (c) a 10k-token
  pre-analysis skip. None exist. This is the single largest true implementation gap in the whole
  research doc — it's not a UI relabeling, it's new merge logic, new rewrite logic, and a new
  analysis-time guard.

### 2.3 `US-ADV-01` — Smart Memory: flat filter vs. two-tier hierarchical loading

- **Old spec:** a generic "relevance filter that reduces injected tokens."
- **Real product:** a specific two-tier mechanism — an AI clustering pass groups a bucket's memories
  into named categories, each with a short **summary** and a longer **additional-context** blurb; at
  recall time only category *summaries* load first, and a category's full memory list expands only
  when the live conversation is judged relevant to it. Hard gates: needs ≥30 memories to categorize at
  all; refuses a bucket over 600,000 tokens or 2,000 memories; only the account's own memory buckets
  qualify (not file buckets, not buckets shared *to* the user); resetting categories is destructive
  and irreversible.
- **Code today:** a flat, single-pass weighted scorer, not two-tier at all.
  `retrievalService.buildContext` (`context/retrieval.service.ts:97-172`) runs one vector-similarity
  query over every candidate every time, scores by
  `similarity*0.6 + recency*0.25 + categoryMatchBonus*0.15` (lines 16-19, 138-146), and greedily packs
  results into the token budget — full memory content is fetched and scored in one pass; there is no
  "load the summary, expand the category later" step anywhere. Categorization itself
  (`memory/categorization.service.ts:45-99`) is incremental per-memory (compare to existing centroids,
  join if within a 0.35 cosine-distance threshold, else ask an LLM to name a new single-memory
  category) — not a batch AI clustering pass over a whole bucket. `Category` (`schema.prisma:215-227`)
  has only `label`, `centroid`, `memoryCount` — no summary field, no additional-context field. None of
  the three hard limits (30 minimum, 600,000-token ceiling, 2,000-memory ceiling) exist anywhere in
  `category/`, `context/`, or `categorization.service.ts` (grep-confirmed no matches — the only "2000"
  in scope is an unrelated default token *request* budget, `retrieval.service.ts:11`). There is no
  file-bucket/shared-bucket exclusion — `Bucket` has no type discriminator at all
  (`schema.prisma:106-125` holds both `Memory[]` and `File[]` on one model), and categorization runs
  per-account regardless of bucket (`categorization.service.ts:25-26`, comment confirms this design).
  There is no reset/regenerate-categories endpoint of any kind — `category.service.ts` exposes only
  `list` and `rename` (lines 7-31).
- **Verdict: Not built.** This is the deepest gap in the report — the "Smart Memory" name is shared,
  but the actual retrieval architecture is different in kind, not degree. Getting to the real
  mechanism means: a batch AI clustering job, a summary+additional-context field pair on `Category`,
  a two-phase retrieval path (load summaries → conditionally expand), three new hard-limit checks, a
  bucket-type discriminator so file/shared buckets can be excluded, and a destructive reset endpoint.

### 2.4 `US-ARC-08` — Core history cap: global 500 vs. per-platform-per-account 500

- **Old spec (as corrected):** cap should be 500 *searchable* conversations from a single platform on
  a single account — a user connecting both ChatGPT and Claude should get 500 of *each*, not 500
  shared across both.
- **Code today:** one global count with no platform dimension. `history-limit.service.ts:20`:
  `prisma.conversation.count({ where: { userId } })` — no `platform` filter, despite
  `Conversation.platform` existing as a field (`schema.prisma:239`) and being ignored by this query.
  `import.service.ts:76` calls the limit check with no platform argument either.
- **Verdict: Not built** (was previously graded "Met" against the *old*, looser spec wording — this is
  a case where the correction directly reverses an existing "Met" verdict). **Fix:** add `platform` to
  the `where` clause and to the function signature; small, contained change, but it is a real behavior
  change for any multi-platform user today silently sharing one pool across platforms.

### 2.5 `US-ARC-02` — Sync: architecture, not just "missing a feature"

- **Old spec (as corrected):** ongoing sync of *new* conversations is only possible via a browser
  extension watching a live chat site — no backend job or MCP/API path can pull new conversations from
  ChatGPT/Claude's own servers, because no such public pull API exists. One-time file-upload backfill
  is a separate, legitimate mechanism. Exclude (wipe content+vectors, keep a placeholder so a future
  sync/re-import never re-adds it) and Delete (remove now, a future sync/re-upload *can* bring it
  back) should be two distinct operations.
- **Code today:** re-read directly, past the prior report's characterization. `sync.service.ts` is
  **not** a live-account sync job — it's the post-import embedding/resume pipeline: given a
  `conversationId` already in Postgres from a file upload, it chunks, embeds, and advances
  `Conversation.syncCursor` so a crash resumes mid-conversation (`sync.service.ts:24-67`); its only
  caller is `import.service.ts:102`, fired synchronously right after upload. No cron/queue triggers it.
  The extension *does* watch live chat pages (`ContentApp.tsx:44-62`, `observeNewTurns`) — but that
  path posts to `/api/capture`, i.e. the **Memory** module (candidate memories needing approval), never
  to chat-history's import/conversation endpoints (grep-confirmed zero references). So there is no
  path anywhere — backend or extension — that ingests new *conversations* into the archive
  automatically; the corrected spec's own explanation of *why* (no pull API exists) matches reality
  exactly. Exclude does not exist at all (zero matches for "exclude" in the module or schema); Delete
  does not exist either — `chat-history.routes.ts:20-26` exposes only import/list/transcript/search/
  usage/insights, no delete of any kind.
- **Verdict: Not built**, and now more precisely scoped than the prior report had it: the fix isn't
  "add a scheduled sync job" in the abstract — it's specifically an extension-side capture path into
  chat-history (mirroring how memory capture already works), because that's the only architecturally
  available capture point. Plus: Delete doesn't exist at all today (not just Exclude), so this needs
  two new operations, not one.

### 2.6 `US-INT-03` — MCP: absent entirely, and the corrected spec needs two auth modes, not one

- **Old spec:** one story, unspecified auth.
- **Real product / correction:** split into local MCP (static bearer token in a config file) and
  remote/hosted MCP (OAuth 2.0 + PKCE + Dynamic Client Registration, no static secret anywhere).
- **Code today:** confirmed absent, full stop — no `mcp` reference anywhere in `backend/src` or
  `backend/prisma` (grep-confirmed), no `@modelcontextprotocol` dependency in any `package.json`, no
  `McpToken` model among the schema's 30 models. The only OAuth in the codebase is Google login for
  app auth (`auth.service.ts:93-107`) — unrelated to PKCE/DCR. Unchanged by either of the two most
  recent commits.
- **Verdict: Not built.** Already known as absent; the correction adds that it's two integrations with
  two different auth architectures, not one — worth splitting into `US-INT-03a`/`US-INT-03b` tickets
  as the research doc itself proposes, so "build MCP" doesn't get scoped as one bearer-token server
  and quietly ship without the remote/OAuth path.

### 2.7 `US-FIL-01`–`04` — File buckets: scope boundary is correct, one behavior isn't fully checked

- **Old spec (as corrected):** files should be reachable from dashboard, Ask, and API/MCP only — *not*
  the browser extension or auto-injection — and scanned/image-only PDFs (no text layer) should be
  explicitly rejected, not silently OCR'd or silently producing empty content.
- **Code today:** the extension-absence part is already correct — `extension/src` has zero references
  to file/upload/pdf/ask capability (grep-confirmed), so the intentional scope boundary is respected
  without anyone having deliberately built to that spec. PDF handling is also already correct:
  `document-parser.provider.ts` filters out zero-text pages, and `processing.service.ts:43-49`
  explicitly sets `status: 'error', errorReason: 'No readable text found in this file.'` when a file
  has no extractable pages — a clean, explicit rejection, not silent garbage.
- **Verdict: Already met**, on both counts. The one open item here is the MCP half of "dashboard/Ask/
  MCP" reachability, which can't be checked until `US-INT-03` (§2.6) exists — file search will need to
  be exposed as an MCP tool once MCP itself is built, and that's currently not tracked as part of the
  MCP absence anywhere.

### 2.8 `US-INT-07` — Desktop agent: one folder wired of three, no Focused-sync toggle

- **Old spec (as corrected):** read-only access to exactly three named folders (`~/.claude`,
  `~/.codex`, `~/.cursor`) and nothing else; a "Focused sync" default where only the user's prompts and
  the agent's final answers ever upload — tool calls, file contents, terminal output, and intermediate
  reasoning must never leave the machine, toggle or not.
- **Code today:** only `claudeCodeSource` is live (`available: true`, reads `~/.claude/projects`,
  `desktop/src/main/sources/claude-code.source.ts:42`). `cursorSource` and `codexSource` are explicit
  stubs — `available: false`, `defaultPaths()` returns `[]` — so `.codex`/`.cursor` are never actually
  read despite being named in the plan. There is no "Focused sync" field anywhere:
  `AgentConfig`/`AgentSettings` (`desktop/src/main/config.ts:25-31`) has no sync-mode setting at all
  (grep-confirmed). The transcript parser (`claude-code.source.ts:22-33`) does only pull `type:"text"`
  blocks, incidentally dropping tool-call/tool-result content — but that's a fixed parsing detail, not
  a deliberate, user-visible, toggleable privacy boundary the way the corrected spec requires.
- **Verdict: Partial**, more precisely than the prior report's flat "Met" — the *pairing/capture/
  review/revoke* mechanics that made it "Met" in `Requirements_Conformance_Report.md` are real and
  tested, but two of the three source folders are stubbed, and the specific "Focused sync" privacy
  guarantee the corrected spec asks for as a named, user-facing setting does not exist as a setting —
  only as an accidental side effect of what the parser happens to extract today. That's a materially
  weaker guarantee: nothing stops a future parser change from also uploading tool-call content, because
  there's no toggle/policy enforcing the boundary.

### 2.9 `US-MEM-05` — Image memories: no signed-URL/description split, no shared-bucket guard

- **Old spec (as corrected):** API responses for image memories should carry a **4-hour-expiring
  signed URL** to the actual image plus a **non-expiring text description** as two distinct fields;
  image memories should be blocked inside shared buckets; upload should be dashboard-only for now.
- **Code today:** images are stored via `localDiskStorageProvider.put()`, which returns one permanent
  static path (`/uploads/<uuid>.ext`, `storage.provider.ts:56`) — no signed URL, no `expiresIn`/
  `expiresAt`, no TTL logic anywhere in the storage layer (grep-confirmed). The public response shape
  (`memory.service.ts:12-24`) is `{ content, imageUrl }` — both fields non-expiring; test
  `image-memory.test.ts:20-21` explicitly asserts the URL is stable across repeated calls, i.e. the
  *opposite* of the corrected behavior. There is no shared-bucket guard on image creation —
  `createImage` (`memory.service.ts:69-91`) checks only `requireBucketMembership(..., 'editor')`, same
  as plain text memory creation, with no check on bucket sharing state. Upload is correctly
  dashboard-only today (`memory.routes.ts:23`; zero image references in `extension/src`), which does
  match the corrected spec.
  - Two things are worth stating plainly here rather than leaving implicit: (1) a permanent public
    static path is exactly the "stale-link liability" the research doc calls out as the risk of
    getting this wrong — every image memory currently has a URL that never expires, by omission rather
    than by decision; (2) the missing shared-bucket guard means an image memory saved into a bucket
    that later gets shared becomes visible to every member with no code path having ever decided that
    should be allowed.
- **Verdict: Not built** for the two behavioral pieces (signed-URL expiry, shared-bucket guard); dashboard-only upload already matches.

### 2.10 `US-ASK-02` — Ask mode lock: re-runs retrieval, but never locks

- **Old spec:** switching mode on an existing question re-runs retrieval under the new scope.
- **Real product / correction:** once an Ask thread has ≥1 message, its mode should become immutable
  for that thread — a new source needs a new thread, not a mode-switch mid-thread.
- **Code today:** `ask.service.ts:114-153` — when `conversationId` is supplied, it loads the existing
  thread (line 121) and unconditionally uses whatever `params.mode` was just passed for retrieval (line
  148) and storage (line 152). There is no comparison against the thread's prior messages' mode, no
  rejection, no lock; `AskMessage.mode` (`schema.prisma:357`) is a plain nullable string with no
  uniqueness/lock constraint. The base behavior the old spec asked for (mode-switch re-runs retrieval,
  doesn't just re-filter a stale cached result) is correctly implemented and already tested — it's
  specifically the *lock* that's missing.
- **Verdict: Not built.** Narrow, contained fix: reject (or ignore) a `mode` argument that differs from
  `AskConversation`'s first message's mode once the thread has ≥1 message. Small — this is one of the
  cheapest items in this whole report to close.

---

## 3. Consolidated gap list, ranked by effort-to-close

Combining §1 (still-open, previously known) and §2 (newly found from the research doc), ordered
roughly cheapest-to-most-expensive:

| # | Story | Gap | Size | Source |
|---|---|---|---|---|
| 1 | `US-ASK-02` | Add a mode-lock check once an Ask thread has ≥1 message | Small | §2.10 (new) |
| 2 | `US-ARC-08` | Add `platform` to the history-cap count query | Small | §2.4 (new) |
| 3 | `US-ACC-05` | Wire the existing `EmailProvider` to export completion | Small | §1 (known) |
| 4 | `US-INT-01` | Build the extension onboarding walkthrough; make something read `onboardingPending` | Small–Medium | §1 (known) |
| 5 | `US-ORG-01` | Add a `strategy` param (move-to-default / delete-contents) to bucket delete | Small–Medium | §1 (known) |
| 6 | `US-MEM-09` / `US-ARC-04` | Wire `useInfiniteQuery` against cursors the API already returns | Small–Medium | §1 (known) |
| 7 | `US-MEM-05` | Add signed-URL expiry (4h) + separate non-expiring description; add shared-bucket guard on image create | Medium | §2.9 (new) |
| 8 | `US-ORG-04` | Add a `contributor` role tier + creator-scoped edit enforcement + fix categorization gating to owner-only | Medium | §2.1 (new) |
| 9 | `US-INT-07` | Wire the two stubbed source folders; add a real, named "Focused sync" setting that constrains what the parser is allowed to extract | Medium | §2.8 (new) |
| 10 | `US-SEC-01` | Stand up real infra or soften the at-rest-encryption claim | Medium (infra-gated) | §1 (known) |
| 11 | `US-ARC-02` | Build extension→chat-history capture path for ongoing sync; add Delete (doesn't exist at all) and Exclude (placeholder-retention) as two distinct operations | Medium–Large | §2.5 (new, more precisely scoped than before) |
| 12 | `US-MEM-06`/`07` | N-way Combine, content-rewriting Update, 10k-token analysis skip — unify into one Suggestions model | Large | §2.2 (new) |
| 13 | `US-ADV-01` | Batch AI clustering, summary+additional-context fields, two-phase retrieval, hard limits, bucket-type exclusion, destructive reset | Large | §2.3 (new — deepest gap in the report) |
| 14 | `US-INT-03` | Build MCP: local (bearer token) and remote (OAuth+PKCE+DCR) as two integrations | Large | §1 + §2.6 (known absence, newly split into two) |
| 15 | `US-INT-04/05/06/08` | Custom GPT, TypingMind plugin, public API docs, Agent Skills install | Large (×4) | §1 (known) |
| — | NFR: async job retry/dead-letter | No retry, no dead-letter, silent embedding failures | Medium–Large | §1 (known) |
| — | `US-FIL-01`–`04` | No new work — already matches the corrected spec | None | §2.7 (new, confirms already-met) |

**Net new scope from the research doc (§2) that wasn't on anyone's list before this report:** items
1, 2, 7, 8, 9, 11 (rescoped), 12, 13, 14 (rescoped). Of these, **§2.3 (Smart Memory's real mechanism)
and §2.2 (unified Memory Suggestions)** are the two that most change the shape of future work — both
are currently graded "Met"/"Should — Met" in `Requirements_Conformance_Report.md` against the old
spec wording, but neither implements the mechanism the real product (and the corrected spec) actually
describes. Everything else in §2 is additive detail on top of already-tracked absences.

---

## 4. What to do next

Same shape as `Requirements_Conformance_Report.md` §7, extended with the new items:

1. **Take the five small fixes first** (rows 1–3 above, plus the two already-known small items,
   rows 4–5): mode-lock, history-cap platform scoping, export email, onboarding walkthrough, bucket
   delete strategy. All contained, no schema redesign, moves five stories from open to closed in
   roughly two days combined.
2. **Re-scope `US-ADV-01` and `US-MEM-06`/`07` as new epics**, not bug fixes — they currently read as
   "Met"/"Should" in the existing conformance report, which will mislead anyone using that report as a
   punch list. The actual Smart Memory retrieval architecture and the actual Memory Suggestions model
   are both different in kind from what's built, not merely incomplete.
3. **Decide `US-ORG-04`'s Contributor role and `US-ARC-02`'s Exclude/Delete split before building
   more on top of the current two-role / import-only foundation** — both are the kind of change that
   gets more expensive the longer other features assume the simpler model (e.g. every future
   permission check written against `viewer/editor/owner` needs revisiting once `contributor` exists).
4. **Treat `US-INT-03` as two tickets from day one** (`US-INT-03a` local, `US-INT-03b` remote) so the
   OAuth+PKCE+DCR path doesn't get silently dropped the way "add MCP" scope often drops its harder
   half.
5. Items 10, 14–15, and the NFR row are unchanged from the prior report's own recommendations — see
   `Requirements_Conformance_Report.md` §7 items 6–9 for those, still accurate as written.

---

## 5. Document control

| Field | Value |
|---|---|
| Report version | 1.0 |
| Audit date | 2026-08-10 |
| Scope | 10 corrections from `MemoryPlugin_Feature_Research.md` §4, cross-checked against code; 7 previously-open items re-verified unchanged |
| Result | 0 of 10 new corrections already implemented (1 partial: `US-INT-07`; 1 already-met by coincidence: `US-FIL-01`–`04`); 7 of 7 previously-known gaps confirmed still open |
| Related | `MemoryPlugin_Feature_Research.md`, `Product_Requirements.md`, `Requirements_Conformance_Report.md`, `Backend_Plan.md`, `Frontend_Plan.md` |
