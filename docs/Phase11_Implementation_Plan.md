# Phase 11 Implementation Plan — Security, Privacy & Compliance

**Source documents:** `Product_Requirements.md` §7.10 (`US-SEC-01`–`05`) and §7.1 (`US-ACC-05`–`08`),
`Backend_Plan.md` Phase 11, `Frontend_Plan.md` Phase 11
**Companion document:** none upstream — this phase closes out account-level commitments Phase 1
made and documented as deferred, rather than building on Phase 9/10's Pro-tier work. It has no
plan-gating of its own; every capability here applies to Core and Pro alike.

---

## 1. Objective

> An export request and a delete request both complete end-to-end and are verifiable in the audit
> log (backend exit criteria). A user can export all their data and, separately, permanently
> delete their account from the UI alone (frontend exit criteria).

The first phase whose entire premise is *closing gaps this codebase has been pointing at since
Phase 1*, not building new product surface. `frontend/src/app/dashboard/settings/privacy/page.tsx:78`
already says it in its own copy: *"Full technical verification of these guarantees lands with the
Security & Compliance phase."* This phase is that sentence's follow-through.

## 2. What already exists vs. what's net-new

| Capability | Status |
|---|---|
| Session list + revoke | **Exists** (Phase 1) — `session.service.ts:22-39`'s `list()`/`revoke()`, wired through `account.controller.ts:35,41`, rendered in `settings/sessions/page.tsx`. `US-ACC-08`'s core loop already works |
| Auto-capture per-platform toggle, *stored* | **Exists** (Phase 1) — `account.service.ts:19,31-38`'s `autoCapture` JSON map, edited from `settings/privacy/page.tsx`, read by the extension (`extension/src/popup/Panel.tsx:144-148`) |
| Auto-capture toggle, *enforced* | **Does not exist** — `grep autoCapture backend/src/modules/memory/` returns nothing. `capture.routes.ts`/`capture.service.ts` accept `{ snippet }` with no `platform` field at all (confirmed in `capture.types.ts`'s `captureSchema`) and never consult the toggle. `US-ACC-07`'s AC ("disabling it stops new automatic suggestions") is currently false for the one path that matters |
| Audit log infrastructure | **Exists** (Phase 1) — `audit.service.ts`'s single `record(userId, action, target?)`, already called from 24 sites across every module (memory/bucket/membership/auth/session/account/apikey/suggestion/chat-search) |
| Audit log *survives account deletion* | **Does not exist** — `AuditLog.userId` is `onDelete: Cascade` from `User` (`schema.prisma:89`). A row proving "this account was deleted" cannot itself live in a table that gets deleted along with the account — `US-SEC-05`'s AC ("an audit log entry records that it happened") is architecturally impossible today for the deletion action specifically |
| Storage delete primitive | **Exists** (Phase 2) — `storage.provider.ts:10-46`'s `StorageProvider.delete()`, implemented and safe (swallows `ENOENT`) in `localDiskStorageProvider`. Not currently called by anything except direct memory/file deletion, never by a bulk account-wipe |
| DB-level cascade from `User` | **Exists and is comprehensive** (accreted since Phase 1) — Session, ApiKey, Bucket, Memory, Category, Conversation, MemorySuggestion, KnowledgeGraphNode/Edge, UsageAnalyticsEvent/Summary, Payment all cascade. `US-SEC-04`'s "removes the user's rows from Postgres" half is **already true** the moment `prisma.user.delete()` runs — the gap is purely the object-storage half (images/file blobs) and the vector half (a no-op: pgvector embeddings are columns on the same cascading rows, not a separate store to clean up) |
| TLS / at-rest encryption config | **Does not exist beyond Postgres/Prisma defaults** — `backend/.env.example`'s `DATABASE_URL` has no `sslmode`; `schema.prisma:10-14`'s datasource block is bare; no `docker-compose*.yml` in the repo. `US-SEC-01` has no deployment-config verification to point to yet |
| Rate limiting / request-size caps | **Exists** (Phase 1) — `rateLimit.ts`'s three limiters, `app.ts`'s `express.json({ limit: '100kb' })`. Not this phase's job to touch, listed here only because it's the kind of thing `US-SEC-01`-adjacent review tends to re-litigate needlessly |

## 3. In scope / out of scope

**In scope**
- **Enforcing** the auto-capture toggle end-to-end (`US-ACC-07`) — the one Phase 1 feature that's
  stored but not consumed
- **Session revoke-all-others** (`US-ACC-08`'s natural companion to single-session revoke, the
  concrete "respond if I think my account is compromised" action a single revoke doesn't cover)
- **Data export**: async job, status tracking, time-limited download link (`US-SEC-03`, `US-ACC-05`)
- **Permanent account deletion**: explicit-confirmation endpoint, storage cleanup + DB cascade,
  survivable audit evidence (`US-SEC-04`, `US-ACC-06`)
- **A compliance-evidence log that outlives the account it's about** (`US-SEC-05`) — the schema
  decision this phase's whole audit trail promise depends on
- **TLS/at-rest encryption verified in deployment config** (`US-SEC-01`) — `DATABASE_URL` `sslmode`
  enforcement in non-dev environments, documented in `SETUP.md`, not merely asserted on the privacy
  page
- **"No training, no sale" as a checked configuration, not just copy** (`US-SEC-02`) — a named
  constant documenting the Anthropic API's data-use terms next to `LlmProvider`'s real-provider
  class, and a one-line audit of `UsageAnalyticsEvent.metadata` to confirm it never carries raw
  content (it doesn't today — `analytics.service.ts`'s four call sites all pass counts/token
  deltas, never `content` — this phase adds a comment recording that fact was checked, not new code)
- Frontend: real export/delete flows on the privacy page (replacing its own "lands with this
  phase" placeholder), revoke-all-others button, encryption/data-use statements pointing at
  something real instead of an assertion

**Explicitly out of scope this phase**
- **A second, S3-compatible `StorageProvider` implementation** — `US-SEC-04`'s "S3-compatible
  storage" line describes the *target* deployment shape, not a requirement to build cloud storage
  in this phase. `StorageProvider.delete()` already works against whatever implementation is
  configured; swapping `localDiskStorageProvider` for a real S3 client is an infra decision
  orthogonal to the deletion *pipeline* this phase builds
- **A dedicated vector database migration** — `US-SEC-04`'s "vectors from the vector index" is
  already satisfied by Postgres cascade, since embeddings are `vector` columns on `Memory`/
  `MessageChunk` rows, not a separate store. Phase 12 covers the *scaling* question; this phase
  only needs the cascade to actually fire, which it already does
- **CSRF tokens** — not named in any `US-SEC` story; the API's bearer-token auth model (not
  cookie-driven session state for authenticated calls) makes classic CSRF largely inapplicable, and
  inventing a requirement not in the PRD isn't this phase's job. Flagged once here so it isn't
  silently assumed to be missing scope
- **Legal/compliance sign-off on the "no training" claim** — `Product_Requirements.md` §10's own
  open question says this needs "a compliance/legal review... not just an engineering
  configuration flag." This phase delivers the engineering half (a checked, documented
  configuration) and flags the legal half as still open, not resolved by code

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| `ComplianceLog` model | Evidence of an export/deletion request must survive the account it's about — `AuditLog` cannot serve this because it cascades from `User` (§2) | A **separate**, deliberately non-`User`-relational table: `userId` stored as a plain string (no FK), plus a denormalized `userEmailSnapshot` for identifying who, since the `User` row may be gone by the time this is read. Mirrors this codebase's existing discipline of choosing the right non-cascading primitive for evidence that must outlive its subject — the same reasoning that gave Phase 10 a separate `ProcessedWebhookEvent` table instead of overloading an existing one |
| `DataExportRequest` model | Export needs to be trackable (`US-SEC-03`: queued/running/complete/failed, visible to the user) and reusable (list past exports, re-download within the expiry window) — a fire-and-forget call with no row would satisfy neither | Cascades from `User` normally (this is operational state, not compliance evidence — the `ComplianceLog` row is the thing that must survive, not this one) |
| `platform` field on the capture request | Server-side enforcement of a per-platform toggle needs to know which platform originated the snippet — today `POST /api/capture` doesn't carry one at all | The extension already has this value for free: `SiteAdapter.name` (`"chatgpt"` \| `"claude"` \| `"gemini"`) is the exact key `account.autoCapture` is keyed by. One field added to `captureSchema` and the `CAPTURE` background message, no new concept |
| An async, one-off background job pattern | `JobRunner` (Phase 5) is built for *recurring* scheduled work (`schedule(name, intervalMs, handler)`); export generation is a *one-off* per-request job with its own status to update mid-flight — forcing it through `JobRunner` would be the wrong tool | A fire-and-forget async function following the exact shape `memory.service.create()`'s `void embeddingService.process(...)` already established: `exportService.request()` creates the row and returns immediately; a detached `void runExport(requestId)` updates `status` as it progresses. No new queue infrastructure — the same "not a real job queue yet" call every prior phase's async work has made |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model DataExportRequest {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  status       String    @default("queued") // "queued" | "running" | "complete" | "failed"
  downloadKey  String?   // StorageProvider key for the generated archive
  errorReason  String?
  requestedAt  DateTime  @default(now())
  completedAt  DateTime?
  expiresAt    DateTime? // set on completion: completedAt + 7 days

  @@index([userId])
}

// Deliberately NOT a relation to User — see §4. This is the one row type in the schema that is
// allowed to reference a user who no longer exists, because that is exactly the case it exists to
// cover (US-SEC-05's "evidence for a future regulatory request").
model ComplianceLog {
  id                String   @id @default(cuid())
  userId            String
  userEmailSnapshot String
  action            String   // "data.export" | "account.delete"
  requestedAt       DateTime
  completedAt       DateTime?
  outcome           String   // "completed" | "failed"

  @@index([userId])
}
```

`Account.autoCapture` and `Session` need no schema changes — both already exist with exactly the
shape this phase reads/writes.

### 5.2 Services

- **`capture.service.ts` retrofit** — `submit(userId, snippet, platform)` checks
  `account.autoCapture[platform] !== false` before calling `extractMemoryCandidates()`; returns an
  empty array (not an error) when disabled, matching the existing "silently skip" comment already
  sitting in `extension/src/content/ContentApp.tsx:51` that describes behavior this phase makes
  true for the first time.
- **`session.service.ts` addition** — `revokeAllOthers(userId, currentSessionId)`: sets `revokedAt`
  on every non-revoked session for the user except the caller's own, in one query. Audited as
  `session.revokeAll`.
- **`export.service.ts`**
  - `request(userId)`: creates a `DataExportRequest` row (`status: 'queued'`), fires
    `void runExport(request.id)`, returns the row immediately — the request/response cycle never
    waits on archive generation.
  - `runExport(requestId)`: sets `status: 'running'`; gathers the user's memories (with version
    history), bucket structure, imported conversations + messages, Ask threads, and file *metadata*
    (filename, size, page count — not re-fetching original bytes the user already has, matching
    `US-ACC-05`'s "not just a subset" as "every category of data," not "every raw file re-bundled")
    into one JSON document; writes it via `getStorageProvider().put()`; sets
    `status: 'complete'`, `downloadKey`, `expiresAt: now + 7 days`. On any thrown error, sets
    `status: 'failed'`, `errorReason` — never left silently `'running'` forever (`US-SEC-03`'s AC).
    Writes a `ComplianceLog` row (`action: 'data.export'`, `outcome` matching) as its last step
    either way.
  - `getDownloadUrl(userId, requestId)`: 404s if not this user's request, 410-equivalent
    (`AppError.forbidden`, code `EXPORT_EXPIRED`) once past `expiresAt`, otherwise resolves a
    download through the storage provider.
  - `list(userId)`: past requests, newest first — so a user can see a failed export and know to
    retry, per `US-SEC-03`.
- **`account-deletion.service.ts`**
  - `deleteAccount(userId, confirmation)`: rejects unless `confirmation === 'DELETE'`
    (`AppError.badRequest`, code `CONFIRMATION_REQUIRED`) — the backend-enforced half of "explicit
    confirmation... not a single accidental click" (`US-ACC-06`'s AC), not a client-only guard.
    Then, in order: (1) enumerates every image `Memory.imageUrl` and every `File.storageKey`
    belonging to the user and calls `storageProvider.delete()` on each — the one cleanup step
    Postgres cascade cannot do for you (§2); (2) writes the `ComplianceLog` row *before* the delete,
    since the reference User row must still exist to snapshot its email; (3) runs
    `prisma.user.delete({ where: { id: userId } })`, whose cascade removes everything else
    (sessions, buckets, memories, conversations, subscriptions, the works). A failure in step 1
    aborts before step 3 — a partially-deleted account (DB rows gone, orphaned storage objects
    left behind) is a worse outcome than a clean retry.

### 5.3 Endpoints

| Method | Path | Auth requirement | Maps to |
|---|---|---|---|
| POST | `/api/capture` (adds `platform` to the body) | session/API key, capture scope where applicable | `US-ACC-07` |
| POST | `/api/account/sessions/revoke-others` | session | `US-ACC-08` |
| POST | `/api/account/export` | session | `US-SEC-03`, `US-ACC-05` |
| GET | `/api/account/export` | session | `US-SEC-03` |
| GET | `/api/account/export/:id/download` | session, ownership-checked | `US-ACC-05` |
| DELETE | `/api/account` (`{ confirmation: 'DELETE' }`) | session | `US-SEC-04`, `US-ACC-06` |

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. Disabling auto-capture for `"chatgpt"` and then submitting a capture with
   `platform: 'chatgpt'` produces zero suggestions; the same snippet with `platform: 'claude'`
   (still enabled) still produces suggestions — proves the toggle is enforced per-platform, not
   globally.
2. `revokeAllOthers()` invalidates every session except the caller's own, verified by a subsequent
   authenticated request on the revoked session failing within the same request cycle (no
   token-refresh grace period) — the exact bar `US-ACC-08` already sets for single-session revoke,
   applied to the "all others" case.
3. A completed export's downloaded archive contains at least one memory, one imported conversation,
   and one file's metadata for a seeded account with all three — proves "not just a subset."
4. An export that throws mid-generation ends in `status: 'failed'` with a non-null `errorReason`,
   never stuck at `'running'` — `US-SEC-03`'s "clearly tells the user to retry" AC, made concrete.
5. `deleteAccount()` without `confirmation: 'DELETE'` (missing, wrong value, or omitted) makes no
   changes at all — no storage deletes attempted, no DB rows touched.
6. After a confirmed deletion: `prisma.user.findUnique` for that id returns `null`; every one of
   their image/file `storageKey`s previously existed on disk and no longer does (checked via
   `fs.access` against `localDiskStorageProvider`'s upload dir); a `ComplianceLog` row for
   `action: 'account.delete'`, `outcome: 'completed'` exists **after** the user row is gone —
   the central proof this phase exists to deliver (`US-SEC-05`).
7. A `ComplianceLog` row's `userEmailSnapshot` correctly identifies a deleted account when the
   `User` table has zero matching rows — proves the design decision in §4 actually solves the
   "survives deletion" requirement, not just schematically.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

An export request and a delete request both complete end-to-end and are verifiable in the audit
log.

---

## 6. Frontend plan

### 6.1 Where this lives

`Settings > Privacy` (`settings/privacy/page.tsx`) gains real sections; nothing new at the
top-level nav — this phase deepens an existing surface rather than adding one.

### 6.2 Screens & components

- **Auto-capture toggles** — unchanged visually; the "you always approve a suggestion before it's
  saved" copy stays accurate, now backed by real enforcement instead of a stored-but-unread value.
- **Data export card** — replaces nothing, adds a new card: a "Request export" button, a list of
  past requests with status badges (queued/running/complete/failed) and a "Download" link that
  appears only once `complete` and disappears once `expiresAt` passes, matching `US-SEC-03`'s
  visible-status AC exactly.
- **Danger zone card** — a new, visually distinct (destructive-styled, bottom of page) section:
  "Delete account and all data," listing in plain language what gets deleted (memories,
  conversations, files, buckets, API keys — the actual cascade list from §2, not a vague summary)
  before the user can proceed. Confirmation requires typing `DELETE` into a text input — the exact
  friction `US-ACC-06`'s AC calls for, enforced again server-side (§5.2) so this isn't
  security-theater.
- **Sessions page addition** — a "Log out all other devices" button next to the existing per-row
  revoke, calling the new `revoke-others` endpoint.
- **"Data handling" card rewrite** — replaces the current placeholder sentence
  (`privacy/page.tsx:78`) with what's actually true now: encryption status, a link to what "no
  training" means technically (not just a bullet), removing the "lands with this phase" language
  since it has now landed.

### 6.3 Data fetching

- `useExportRequests()`, `useRequestExport()`, `useDeleteAccount()`, `useRevokeAllOtherSessions()`
  — plain query/mutation shapes, nothing new architecturally.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A user can export all their data and, separately, permanently delete their account from the UI
alone.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3 … Phase 10 §7) — only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Evidence-survives-its-subject modeling | `domain-modeling` | `ComplianceLog`'s non-`User`-relational design is the phase's one real schema decision — get it wrong (an FK that cascades) and the entire audit-trail promise this phase exists to deliver is architecturally false, exactly the way `AuditLog` already is today |
| Deletion ordering / partial-failure safety | `nodejs-backend-patterns` | Storage cleanup must complete *before* the DB cascade fires, and a failure partway through must not leave orphaned storage objects with no DB row to ever find them again — an ordering bug here is unrecoverable, not just incorrect |
| Fire-and-forget async job status | `prisma-client-api` | Export's `queued → running → complete/failed` transitions reuse the same "the request returns before the async work finishes" idempotency discipline `embedding.service.ts` established, just with a status column to poll instead of a `waitFor()`-style test helper |
| Test-first | `tdd` | "The deleted user's row is really gone" and "the compliance log entry survives it" are exactly the kind of claim that looks satisfied by a passing happy-path test while silently being false — this discipline is what catches the ordering bug before it ships |
| Adversarial security pass | `security-review` | This phase moves from "revoke my own session" to "irreversibly delete everything," and from "download my own export" to a token that must not be guessable or usable by anyone else — a dedicated adversarial pass on confirmation-bypass, cross-user download-key access, and export-link expiry belongs here, not just standard `code-review` |
| Visual consistency for a destructive flow | `web-design-guidelines` | A "delete everything" affordance has to look and read as serious without becoming a dark pattern (no tricking someone out of canceling) — accessible focus order and unambiguous copy matter more here than on any prior settings screen |

## 8. Delivery order (suggested)

1. **Backend infra:** `ComplianceLog`/`DataExportRequest` schema migration; `platform` added to
   `captureSchema`
2. **Backend:** `capture.service.ts`'s enforcement retrofit, tests first (per-platform disable
   proof)
3. **Backend:** `session.service.ts`'s `revokeAllOthers()`, tests first
4. **Backend:** `export.service.ts`, tests first (status transitions, content completeness,
   failure-doesn't-hang)
5. **Backend:** `account-deletion.service.ts`, tests first (confirmation gate, ordering,
   `ComplianceLog` survives) — the highest-stakes tests in the codebase to date, run individually
   before moving on, not as one sweeping change
6. **Backend:** endpoints; full Phase 1–10 regression suite green
7. **Frontend:** export card, danger-zone deletion flow, revoke-all-others button, rewritten data
   handling copy
8. **Both:** `security-review` (confirmation bypass, download-key guessing/cross-user access,
   export-link expiry enforcement) and `code-review`/`web-design-guidelines` passes; confirm exit
   criteria against a real seeded account with memories, conversations, files, and buckets — not an
   empty one, so the export/delete actually has something to prove it handled

## 9. Alignment with prior phases

- **This phase changes no plan-gating.** Export and deletion apply identically to Core and Pro —
  there is no `requirePlan()` call anywhere in this plan, deliberately, since nothing in
  `US-SEC-01`–`05` or `US-ACC-05`–`08` is tier-gated in the PRD.
- **`analytics.service.ts` (Phase 9) is verified, not modified.** §3 notes this phase confirms
  `UsageAnalyticsEvent.metadata` never carries raw content by reading its four call sites, rather
  than adding new redaction logic — the existing code already satisfies `US-SEC-02`'s analytics
  boundary; this phase's job is confirming that in writing, not re-engineering something that
  isn't broken.
- **`storageProvider.delete()` (Phase 2) is reused as-is.** No change to the provider interface —
  this phase is the first caller to invoke it as part of a bulk operation rather than a single
  record's lifecycle, proving the interface generalizes.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Encryption in transit and at rest (`US-SEC-01`) | §3's `DATABASE_URL` `sslmode` + `SETUP.md` deployment doc |
| No training on user data, no data sale (`US-SEC-02`) | §3's documented `LlmProvider` data-use constant + analytics-boundary confirmation |
| Data export completion and tracking (`US-SEC-03`) | §5.2 `export.service.ts`, §6.2 export card |
| Permanent deletion cascade (`US-SEC-04`) | §5.2 `account-deletion.service.ts`, §2's cascade audit |
| Audit log for compliance requests (`US-SEC-05`) | §4/§5.1 `ComplianceLog` |
| Data export (`US-ACC-05`) | §5.2/§5.3 export endpoints |
| Permanent account/data deletion (`US-ACC-06`) | §5.2/§5.3 deletion endpoint, §6.2 danger zone |
| Privacy and auto-capture consent controls (`US-ACC-07`) | §5.2 `capture.service.ts` retrofit |
| Session and device management (`US-ACC-08`) | §5.2 `revokeAllOthers()`, §6.2 sessions page addition |

## 11. Definition of done

- [ ] All Phase 11 endpoints in §5.3 implemented and covered by tests written per §5.4
- [ ] Phase 1–10's existing test suite still passes unmodified
- [ ] Backend exit criteria (§1) demonstrated: a real export request and a real delete request each
      run to completion against a seeded account, verified in `ComplianceLog` afterward
- [ ] Frontend exit criteria (§1) demonstrated live: export and delete both completable from the UI
      alone, no direct API calls needed
- [ ] `security-review` run specifically against confirmation-bypass, cross-user export-download
      access, and export-link expiry, in addition to the standard `code-review`/
      `web-design-guidelines` passes
- [ ] `SETUP.md` documents the `sslmode`/TLS expectation for non-dev `DATABASE_URL`s
- [ ] The `Product_Requirements.md` §10 open question on "no training" legal review is explicitly
      carried forward as still-open in this document's own record, not silently dropped because the
      engineering half shipped
