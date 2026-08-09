# Requirements Conformance Report

**Date:** 2026-08-09
**Branch:** `claude/desktop-agent` · **HEAD:** `cd38a87`
**Audited against:** `Product_Requirements.md` (59 user stories, 8 non-functional requirements),
`Backend_Plan.md` (Phases 0–12 exit criteria), `Frontend_Plan.md`, and the thirteen phase
implementation plans.

---

## 1. Method

Every `US-*` story was checked against the code that claims to satisfy it — the route, the service,
the UI component, and the test — not against a plan document saying it was done. Where a story has
Given/When/Then criteria, each clause was checked separately, because a story can be 80% built and
still fail the one clause that mattered.

Three verdicts are used, and they mean different things:

| Verdict | Meaning |
|---|---|
| **Met** | Every acceptance clause is implemented, and the behaviour is asserted by a test or was observed running. |
| **Partial** | The story's core works, but at least one acceptance clause is not satisfied. Each one is itemised in §4 with the specific clause and file. |
| **Not built** | No implementation exists. |

"Met" never means "the code exists and compiles." Where something is built but has never run
against the real third party (Stripe, Google OAuth, a live AI site), that is stated on the row.

### Test baseline at time of writing

| Suite | Result |
|---|---|
| Backend | **160 passed / 160**, 22 suites, against real Postgres + pgvector |
| Desktop agent | **30 passed / 30**, 4 suites |
| Frontend | typecheck clean, `next build` clean |
| Extension | typecheck clean, build clean |

---

## 2. Headline

**45 of 59 stories are Met. 8 are Partial. 6 are Not built.**

By priority, which is what actually matters for a launch decision:

| Priority | Met | Partial | Not built | Total |
|---|---|---|---|---|
| **Must** | 21 | 6 | 2 | 29 |
| **Should** | 18 | 2 | 2 | 22 |
| **Could** | 6 | 0 | 2 | 8 |

The two unbuilt **Must** stories are `US-INT-01` (extension walkthrough) and `US-INT-03` (MCP).
MCP was knowingly deferred and is documented everywhere. The walkthrough was not — that is the
single most important finding in this report.

The findings that were **not** already on the record:

1. **`US-INT-01` — the extension onboarding walkthrough does not exist.** An `onboardingPending`
   flag is written on install and **no code ever reads it**. A Must-priority story that step 9 of
   the Phase 8 delivery order called for, that no status document has flagged, and that I have
   previously reported as part of a completed phase.
2. **`US-MEM-09` / `US-ARC-04` — the API paginates, the UI does not.** A user with 1,000 memories
   can reach 50 of them; a 400-message transcript stops at 100. From the user's side this is
   indistinguishable from data loss.
3. **`US-ARC-02` — "automatic, idempotent sync" delivers the idempotent half only.** There is no
   automatic sync: import is a manual file upload.
4. **`US-ORG-01` — bucket deletion refuses instead of asking.** The AC requires asking what happens
   to the bucket's memories; the implementation blocks deletion of any non-empty bucket.
5. **`US-ACC-05` — export completion is visible in-app but no notification is sent.**
6. **`US-SEC-01` — the privacy page asserts at-rest encryption that no deployment backs up.** The
   only place the product's own UI over-claims.

Everything else that is missing was already known and documented.

---

## 3. Story-by-story results

### 3.1 Account & Access (`US-ACC-01`–`08`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| ACC-01 Sign up / log in | Must | **Met**¹ | `auth.routes.ts` register/login/refresh/logout + `/google/callback`; `auth.test.ts` covers strength validation and the non-enumerating error |
| ACC-02 Dashboard shell | Must | **Met** | Five sections in the sidebar, each one click from anywhere; empty states on every list |
| ACC-03 API key management | Must | **Met** | `apikey.service.ts` — raw key returned once only; revoked keys fail on the next request (`authenticate.ts` reads `revokedAt`), `lastUsedAt` stamped |
| ACC-04 Plan / usage visibility | Should | **Met** | `billing/summary` + billing page: trial countdown, and the 90 %-of-cap warning fires *before* the limit |
| ACC-05 Data export | Must | **Partial** | See §4.4 — content and expiry are right; the "completion notification" is in-app polling only |
| ACC-06 Account deletion | Must | **Met** | Typed-confirmation dialog listing what will be deleted; `account-deletion.service.ts`; `compliance.test.ts` |
| ACC-07 Auto-capture consent | Should | **Met** | `capture.service.ts:autoCaptureAllowed` is the single enforcement point; six platform toggles; disabling stops new suggestions only |
| ACC-08 Session management | Should | **Met** | Session list with device + last-active; revocation invalidates **within the request cycle** — verified by test |

¹ Google OAuth is implemented end-to-end but has never completed a round trip against real Google
credentials. The login button says so on its face.

### 3.2 Memory (`US-MEM-01`–`09`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| MEM-01 Manual creation | Must | **Met** | Empty content rejected; embedding queued off the request path |
| MEM-02 One-click save | Must | **Met**² | `POST /memories/one-click` stores the highlighted text verbatim — no LLM rewrite on this path |
| MEM-03 Capture with confirmation | Must | **Met** | Capture only ever writes a pending `MemorySuggestion`; identical snippet never re-asked (`capture.test.ts`) |
| MEM-04 Edit / delete | Must | **Met** | Edit writes a new version; delete is confirmed and drops the memory from retrieval immediately |
| MEM-05 Image memories | Should | **Met** | PNG/JPEG upload, thumbnail, and image memories appear in retrieval (`image-memory.test.ts`) |
| MEM-06 Duplicate detect / merge | Should | **Met** | All three Given/When/Then clauses tested in `duplicate-stale.test.ts`, including merged version-history preservation |
| MEM-07 Stale detect / review | Should | **Met** | All three clauses tested; approval marks inactive rather than hard-deleting |
| MEM-08 Version history | Should | **Met** | Every edit versioned with timestamp and actor; viewing a version does not activate it |
| MEM-09 Scalable browsing | Should | **Partial** | See §4.2 — the API paginates, the UI does not |

² The "under 2 seconds from click to confirmation" clause has never been measured. The request is
a single insert and is very likely inside budget, but this report does not claim numbers nobody ran.

### 3.3 Organization (`US-ORG-01`–`04`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| ORG-01 Create / rename / delete buckets | Must | **Partial** | See §4.1 — create and rename are correct; delete refuses rather than asking |
| ORG-02 Move items between buckets | Should | **Met** | Exactly one bucket per item, enforced in schema and tested |
| ORG-03 Bucket filtering everywhere | Must | **Met** | One `bucketAccess` middleware used by Memory, Files, and Ask; filtering by an inaccessible bucket returns 403 server-side |
| ORG-04 Shared buckets and roles | Must · Pro | **Met** | All five Given/When/Then clauses tested, including "removal revokes access on the very next request" and last-owner protection |

### 3.4 Chat History Archive (`US-ARC-01`–`08`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| ARC-01 Import conversations | Must | **Partial** | See §4.5 — ChatGPT and Claude parsers only, 2 of the 6 named platforms. Known and documented; no format was guessed at |
| ARC-02 Automatic, idempotent sync | Must | **Partial** | See §4.3 — idempotency is real and tested; automatic sync, cancel, and resume are absent |
| ARC-03 Semantic search | Must | **Met** | Keyword-free query surfaces the right conversation above unrelated ones; previews returned |
| ARC-04 Transcript viewer | Should | **Partial** | See §4.2 — turn attribution is correct; the first 100 messages are all a user can ever reach |
| ARC-05 Conversation summaries | Should · Pro | **Met** | Generated asynchronously after import; visible in the list without opening the transcript |
| ARC-06 Monthly insights | Could · Pro | **Met** | `insight.service.ts` runs on a schedule; a low-activity month returns an honest "not enough data" state |
| ARC-07 High-accuracy recall | Could · Pro | **Met** | `chat-search.service.ts` re-ranks the top candidates in `precise` mode, distinct from raw vector order |
| ARC-08 Plan-based history limits | Should | **Met** | Cap enforced server-side via `capFor()`; the UI warns before the limit rather than after |

### 3.5 Files & Knowledge Base (`US-FIL-01`–`04`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| FIL-01 Upload and track processing | Must | **Met** | Unsupported types rejected up front; processing → ready → error with a reason |
| FIL-02 File buckets | Should | **Met** | Same bucket component and same server-side access rules as memories |
| FIL-03 File Q&A with citations | Must | **Met**³ | Answer carries page citations; a question with no relevant content returns an honest no-answer (`file.test.ts`) |
| FIL-04 File search | Should | **Met** | Matches extracted content, not filename; results identify file and location |

³ Clicking a citation jumps to the page and shows the exact source passage. It does not open a
full in-browser PDF viewer — the passage is shown rather than the rendered page. The UI states this.

### 3.6 Ask (`US-ASK-01`–`06`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| ASK-01 Cross-store question | Must | **Met** | All three clauses tested, including the honest "no relevant context" answer with zero citations |
| ASK-02 Mode selection | Should | **Met** | Switching mode **re-runs retrieval** rather than filtering a cached result — explicitly tested |
| ASK-03 Source references | Must | **Met** | Every used source is listed and individually attributable |
| ASK-04 Saved threads | Should | **Met** | Threads persist with sources; follow-ups carry prior turns as context |
| ASK-05 Bucket-scoped Ask | Should | **Met** | 403 on a non-member bucket; never surfaces another bucket's content, even one the same user owns |
| ASK-06 Copy response | Could | **Met** | Copies the answer text; citation behaviour is consistent |

### 3.7 Cross-AI Integrations (`US-INT-01`–`08`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| INT-01 Extension onboarding walkthrough | Must | **Not built** | See §4.7 — the flag is written, nothing reads it |
| INT-02 Quick Inject | Must | **Met**⁴ | Content script injects the same assembly `context/preview` returns, without navigating away |
| INT-03 MCP connection | Must | **Not built** | No `McpToken` model, no MCP server |
| INT-04 Custom GPT setup | Should | **Not built** | — |
| INT-05 TypingMind plugin | Could | **Not built** | — |
| INT-06 Open API + documentation | Should | **Not built** | No versioned public spec; no endpoint is marked internal vs. public |
| INT-07 Desktop sync agent | Could | **Met** | Phase 13. Pairing requires a visible dashboard confirmation; captures are reviewable before finalisation. Installers unsigned — see §5 |
| INT-08 Agent Skills install | Could | **Not built** | — |

⁴ The site adapters' DOM selectors have never been verified against live, authenticated ChatGPT /
Claude / Gemini sessions. Quick Inject is verified against the extension's own test page only.

### 3.8 Advanced Intelligence (`US-ADV-01`–`03`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| ADV-01 Context preview + token savings | Should | **Met** | With 100+ seeded memories the preview returns strictly fewer memories and a lower token count; the figure shown matches an independent tokenizer count; Smart Mode off returns the unfiltered set from the same endpoint, with no stale cache across the toggle — all four asserted |
| ADV-02 Knowledge graph explorer | Could · Pro | **Met** | Every edge carries a `source_ref` back to a memory or conversation; SVG rendering stays navigable at a few hundred nodes |
| ADV-03 Usage analytics | Could · Pro | **Met** | Figures are aggregated from the real event log — no placeholder numbers |

### 3.9 Billing & Plans (`US-BIL-01`–`04`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| BIL-01 Pricing comparison | Must | **Met** | Pricing page and the gates both read `PLAN_FEATURES` — they cannot disagree |
| BIL-02 Upgrade / downgrade | Must | **Met**⁵ | Upgrade unlocks on payment confirmation; downgrade takes effect at period end |
| BIL-03 Trial and refund enforcement | Must | **Met**⁵ | Both computed server-side from real timestamps; 14-day refund window from `paidAt` |
| BIL-04 Pro feature gating | Should | **Met** | Server-side via `isEntitled()`; hitting a gate returns an upgrade path, not a generic error |

⁵ Stripe has never made a real network call. All billing behaviour is verified against the stub
payment provider and synthetic webhooks.

**Free-deployment mode:** with `PAYMENTS_ENABLED=false`, `entitlements.ts` reports every account as
entitled, the pricing and billing surfaces state that plainly, and BIL-01–04 are not applicable.
Covered by `payments-flag.test.ts`.

### 3.10 Security, Privacy & Compliance (`US-SEC-01`–`05`)

| Story | Priority | Verdict | Evidence |
|---|---|---|---|
| SEC-01 Encryption in transit and at rest | Must | **Partial** (§4.6) | Transit is enforced: `assertDatabaseTls()` refuses to boot in production without `sslmode`, helmet + HSTS on responses. **At-rest encryption is an infrastructure property that cannot be verified because no infrastructure exists** — the AC requires "verified in deployment config", and there is no deployment config |
| SEC-02 No training, no sale | Must | **Partial** (§4.6) | Technically enforced: the LLM provider abstraction is the only path user content takes, and analytics store counts and IDs — never content, confirmed in the `UsageAnalyticsEvent` schema. **The legal review of the provider's data-use terms is still outstanding**, and the PRD requires it before the claim goes on a page |
| SEC-03 Export completion tracking | Must | **Met** | queued/running/complete/failed all visible; a failed export tells the user to retry rather than failing silently |
| SEC-04 Deletion cascade | Must | **Met** | Postgres rows, vectors (via row cascade), **and** storage objects — all three, in that order, with the compliance log written only after success |
| SEC-05 Compliance audit log | Should | **Met** | `ComplianceLog` deliberately has no User FK so it survives the deletion it records; holds metadata and an email snapshot, never content |

---

## 4. The gaps in detail

### 4.1 `US-ORG-01` — bucket deletion refuses rather than asking (**Must**)

**AC:** *"deleting a bucket asks what happens to its memories (move to default vs. delete) rather
than silently doing one or the other."*

**Actual:** `bucket.service.ts:67` blocks deletion of a bucket with sub-buckets, and `Memory.bucket`
has no cascade, so the database refuses deletion of a bucket holding memories. The dialog says
*"Move or delete anything inside it first."*

This is not silent — the user is told — but it is not what the AC asks for either. It converts a
one-step operation into an unbounded manual chore: a bucket with 200 memories cannot be deleted
without moving all 200 by hand. **Fix:** add a `strategy: 'move-to-default' | 'delete-contents'`
parameter to `DELETE /api/buckets/:id` and a radio choice in the dialog. Small, well-bounded.

### 4.2 `US-MEM-09` and `US-ARC-04` — the API paginates, the UI does not (**Should**)

**MEM-09 AC:** *"list view remains responsive (virtualized/paginated) past 1,000 memories."*
**ARC-04 AC:** *"very long transcripts load progressively rather than freezing the page."*

**Actual:** the backend implements proper cursor pagination for both (`memory.types.ts:13`,
`chat-history.controller.ts:35`). The frontend then calls them with a fixed page and never asks for
a second one:

- `dashboard/memories/page.tsx:26` — `api.memories({ limit: 50 })`, no infinite scroll, no "load more"
- `dashboard/chat-history/[id]/page.tsx:18` — `api.transcript(id, { limit: 100 })`, same

`content-visibility` keeps the rendered rows cheap, which is why this reads as fast. But a user with
1,000 memories can only ever see 50 of them, and a 400-message transcript silently stops at 100.
That is worse than slow: it is **invisible data loss from the user's point of view**.

**Fix:** `useInfiniteQuery` against the cursor both endpoints already return. Perhaps an hour of
work per surface; the server side needs nothing.

### 4.3 `US-ARC-02` — no automatic sync (**Must**)

**Story:** *"Automatic, idempotent sync… so that re-running a sync is always safe."*

**Built:** idempotency, properly. `import.service.ts` upserts on `(bucketId, platform, externalId)`
falling back to `contentHash`, and re-running the same import produces zero duplicates — the Phase 5
exit criterion, tested.

**Not built:** the *automatic* half. There is no connected-account sync, no scheduled sync job, no
cancel, and no failure-resume. `POST /api/chat-history/import` takes an uploaded export file and
nothing else. Two of the story's three Given/When/Then clauses (cancel mid-sync; resume after
partial failure) have nothing to exercise them.

The idempotent upsert means a user re-uploading a fresh export gets correct incremental behaviour,
so the *outcome* is reachable manually. The scheduled, hands-off experience the story describes is
not there.

### 4.4 `US-ACC-05` — export completion is not notified (**Must**)

**AC:** *"user receives a completion notification with a download link; link expires after a
reasonable window."*

**Built:** contents (memories, conversations, files, buckets, Ask threads, suggestions — more than
the AC's minimum), a download link, and a 24-hour expiry that **fails closed** on a missing
`expiresAt`.

**Not built:** the notification. The UI polls every 2 seconds while a request is in flight and
updates in place. A user who closes the tab is never told. An `EmailProvider` already exists (built
for bucket invites in Phase 3) and is not wired to this.

**Fix:** one `emailProvider.send()` call at the end of `export.service.ts`'s completion path.

### 4.5 `US-ARC-01` — 2 of 6 import platforms (**Must**)

ChatGPT and Claude parsers exist and are tested. Gemini, TypingMind, Grok, and DeepSeek do not —
no verified export format was available, and nothing was guessed at and shipped as if it worked
(`chat-import.provider.ts:133`). The import wizard states which platforms are supported, which is
the part of the AC that *is* met; the story's list of six is not.

This was already documented before this audit and is repeated here only for completeness.

### 4.6 `US-SEC-01` / `US-SEC-02` — the parts that cannot be closed by code

Both are Partial for reasons that are not engineering gaps:

- **At-rest encryption** is a property of a Postgres instance and an object store that do not exist
  yet. The AC explicitly requires verification "in deployment config — not merely asserted in a
  privacy page", and the privacy page currently asserts it. **This is the one place where the
  product's UI states something the deployment cannot yet back up**, and it should be softened or
  the infrastructure stood up before launch.
- **No-training** is technically enforced everywhere the code can enforce it. The outstanding piece
  is the legal review the PRD itself names as an open risk.

### 4.7 `US-INT-01` — the extension walkthrough was never built (**Must**)

`background/index.ts:82` sets `chrome.storage.local.set({ onboardingPending: true })` on install.
Nothing in `extension/src` ever reads that key — verified by grep across the whole package. There is
no walkthrough, and no "replay from settings" entry point.

The dashboard's own first-run tour (`onboarding-tour.tsx`) is a *different* thing: it covers the web
app, is marked seen via `hasSeenTour`, and has no replay control either.

This is a Must-priority story with no implementation, and — unlike MCP or the public API — it was
never recorded anywhere as deferred. Step 9 of the Phase 8 delivery order lists "onboarding
walkthrough + replay" and it was not done. **Correcting the record is the point of this section.**

### 4.8 Non-functional: async jobs have no retry or dead-letter (**NFR**)

**Requirement:** *"Every async job (embedding, sync, summarization, knowledge-graph extraction) has
status, retry policy, and dead-letter handling."*

**Actual:** `job-runner.provider.ts` is a `setInterval` loop whose failure handler is
`logger.error(...)`. There is no retry, no attempt counter, no dead-letter store, and no status a
user or operator can query per job. The embedding pipeline is the sharpest case:
`embedding.service.ts:26` catches every failure and logs it, leaving the memory permanently without
an embedding — **invisible to the user, who simply finds that one memory never turns up in search.**

The `/api/ops/health` endpoint reports aggregate job backlog, which is a partial answer to "status"
but not to retry or dead-lettering.

This was a conscious, documented deferral (in-process runner over BullMQ, Phase 5 §4), and the
interface is designed so a real queue drops in behind it. It is listed here because the NFR is not
met today and the failure mode is silent.

---

## 5. Backend plan — phase exit criteria

| Phase | Exit criterion | Verdict |
|---|---|---|
| 0 Foundations | Hello-world service reads/writes Postgres **and Redis** in **staging via CI/CD** | **Not met.** No Redis (in-memory `CacheProvider`), no S3 (local-disk `StorageProvider`), no staging or prod environment, no deploy pipeline, no error tracking. CI runs tests only |
| 1 Accounts | Auth via session and via API key against a protected endpoint | **Met** |
| 2 Memory | Near-duplicates produce a suggestion within seconds; edits produce version history | **Met** |
| 3 Buckets | Viewer can read but not edit; editor can | **Met** |
| 4 Smart Memory | 100+ memories → small relevant subset, measurably fewer tokens | **Met** |
| 5 Chat History | Same import twice → zero duplicates; semantic query hits without keyword overlap | **Met** |
| 6 Files | PDF query returns an answer plus the exact page | **Met** |
| 7 Ask | One query answers from a memory, a conversation, and a file, each cited | **Met** |
| 8 Integrations | Same context via extension, via MCP from Cursor, and via public API | **Not met.** Two of the three paths do not exist |
| 9 Advanced | Graph links a project memory to a client bucket and a conversation, each edge traceable | **Met** |
| 10 Billing | Downgrade immediately restricts Pro endpoints; webhook failures retried and logged | **Met against the stub.** Never exercised against Stripe |
| 11 Compliance | Export and delete complete end-to-end, verifiable in the audit log | **Met** |
| 12 QA | Documented load-test results within budget; successful restore drill on record | **Partially met.** Restore drill executed and recorded; **k6 load tests have never run** |
| 13 Desktop agent | Pair, capture, review, revoke — end-to-end | **Met.** Verified against a live backend; installers unsigned |

**Phase 0 deserves a note.** Its exit criterion is the only one that was never met *and* never
revisited, and it is the root of several downstream partials: no Redis is why the job runner is
in-process; no S3 is why storage is local disk; no staging is why nothing has run against real
Stripe, real Google, or a real load test. Every phase after it was built on a foundation the plan
assumed would exist.

---

## 6. Frontend plan conformance

| Area | Verdict |
|---|---|
| Next.js + React + TypeScript + Tailwind + shadcn/ui as specified | **Met** |
| Notebook design system applied consistently across dashboard, extension, and desktop app | **Met** |
| WCAG 2.1 AA on core flows (FE-12 gate) | **Met** — axe-core sweep in CI; the `--muted-foreground` contrast defect it caught is fixed at the token |
| Dashboard time-to-interactive < 2.5 s | **Unverified.** Lighthouse CI was specified in the Phase 12 plan and never built; only the accessibility sweep exists |
| Zod schemas shared between frontend forms and backend validation (NFR) | **Not met.** Both sides use Zod, but the schemas are written twice — there is no shared package. `Backend_Plan.md` Phase 0 called for a "shared DTO/type package" that does not exist |

---

## 7. What to do next

Ordered by risk retired per unit of effort.

1. **Build the extension walkthrough (`US-INT-01`).** A Must story with zero implementation, and
   the smallest of the four Must-partials. Half a day.
2. **Wire pagination into the two list UIs (`US-MEM-09`, `US-ARC-04`).** The server work is done.
   Users currently cannot reach their own data past the first page. ~2 hours.
3. **Send the export completion email (`US-ACC-05`).** One call into an `EmailProvider` that
   already exists. ~1 hour.
4. **Soften or substantiate the at-rest encryption claim (`US-SEC-01`).** Either stand up the
   infrastructure or change the privacy page copy. This is the only outright over-claim in the
   product's own UI, and it is a legal exposure, not a bug.
5. **Add the bucket-deletion strategy parameter (`US-ORG-01`).** Half a day, removes a genuinely
   painful manual chore.
6. **Stand up Phase 0.** Redis, object storage, a staging environment, and a deploy pipeline. This
   is the prerequisite for the load tests, the Stripe verification, the Google OAuth verification,
   and any real retry/dead-letter implementation — five separate open items all blocked behind it.
7. **Run the k6 load tests.** The last unmet Phase 12 exit criterion, and it needs #6 first.
8. **Decide on `US-ARC-02`'s automatic sync**: build the scheduled connector, or amend the story to
   match the manual-import reality. Right now the document and the product disagree.
9. **Close the `US-SEC-02` legal review** before the no-training claim appears on any marketing or
   pricing page.

Items 1–3 and 5 together are roughly two days of work and move three Must stories and one Should
story from Partial to Met.

---

## 8. Document control

| Field | Value |
|---|---|
| Report version | 1.0 |
| Audit date | 2026-08-09 |
| Stories audited | 59 user stories + 8 non-functional requirements + 14 phase exit criteria |
| Result | 45 Met · 8 Partial · 6 Not built |
| Test baseline | backend 160/160 (22 suites) · desktop 30/30 (4 suites) · frontend and extension typecheck + build clean |
| Related | `Product_Requirements.md`, `Backend_Plan.md`, `Frontend_Plan.md`, `Build_Status_Report.md`, `Operations_Runbook.md` |
