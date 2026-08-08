# Phase 3 Implementation Plan — Buckets & Organization

**Source documents:** `Product_Requirements.md` (§7.3, epics `US-ORG-01`…`US-ORG-04`),
`Backend_Plan.md` (Phase 3), `Frontend_Plan.md` (Phase 3), `Phase1_Implementation_Plan.md` /
`Phase2_Implementation_Plan.md` (precedent format + what's actually been built so far)
**Companion document:** `Phase4_Implementation_Plan.md` — Phase 4's retrieval engine is
bucket-scoped, so every RBAC decision made here is a load-bearing dependency for it, not a
parallel, independent effort. §9 of this document and §3 of Phase 4's cross-reference the exact
seams. Phase 4's design also surfaced a gap in this phase's original scope — see §3.1 below.

---

## 1. Objective

> A viewer-role member can read but not edit memories in a shared bucket; an editor can (backend
> exit criteria). A user can create a "Client A" bucket, move memories into it, and invite a
> teammate as an editor (frontend exit criteria).

## 2. What already exists vs. what's net-new

Phase 2 introduced a **minimal** `Bucket` model one phase early, specifically so
`Memory.bucketId` would never be null (see `Phase2_Implementation_Plan.md` §5.1) — but it only
ever gets a bucket through an internal `getDefaultBucketId()` helper in `memory.service.ts`.
There is no bucket API surface, no nesting, no sharing, and `memory.service.list()` doesn't
filter by bucket. Concretely, Phase 3 must:

| Exists (Phase 2) | Net-new (Phase 3) |
|---|---|
| `Bucket { id, userId, name, isDefault, createdAt }` | `parentId` (nesting), `BucketMember` (sharing), `BucketInvite` (pending invitations) |
| `getDefaultBucketId()` internal helper | `bucket.service.ts` with a real CRUD + move API |
| `Memory.bucketId` always set, never queried on | Bucket-scoped filtering in `memory.service.list()` |
| Every memory query implicitly scoped by `userId` only | Every bucket-scoped query scoped by **role**, not just ownership |

This matters because it means Phase 3 isn't purely additive — `memory.service.ts` and its tests
from Phase 2 change (a new optional `bucketId` filter, and access checks that now depend on
`BucketMember` role, not just `userId === memory.userId`).

## 3. In scope / out of scope

**In scope**
- Bucket CRUD (create/rename/delete), nested buckets (`parentId`), a default bucket per user
  (already exists, now user-renameable but not deletable — see AC below)
- Move/assign memories between buckets (`US-ORG-02`)
- Bucket-scoped filtering, built once and reused (`US-ORG-03`) — this phase only has Memory to
  filter, but the component/query-filter shape must not need to change when Files (Phase 6) and
  Ask (Phase 7) reuse it
- Shared buckets: invite-by-email, accept flow, owner/editor/viewer roles, role enforcement
  server-side on every bucket-scoped endpoint (`US-ORG-04`)
- **§3.1 addendum, added after Phase 4 planning surfaced it:** make Phase 2's duplicate/stale
  detection (`duplicate-detection.service.ts`, `stale-detection.service.ts`) bucket-aware. Today
  those services compare a memory only against its *own creator's* other memories (`WHERE
  "userId" = ...`). Once a bucket can have multiple contributors, two collaborators saving
  near-identical facts into the same shared bucket would never be flagged against each other —
  silently defeating the feature's purpose for exactly the case sharing makes common. Fix: widen
  the candidate query from `WHERE "userId" = ${userId}` to `WHERE "bucketId" = ${bucketId}` (join
  through `BucketMember` isn't needed for the candidate set itself — a memory's `bucketId` already
  encodes which bucket it's in; the join *is* needed for who gets to see/act on the resulting
  suggestion, which §6.4's suggestion-visibility decision already covers). This is additive to
  Phase 2's existing services, not a rewrite — see `Phase4_Implementation_Plan.md` §9 for how this
  was found.

**Explicitly out of scope this phase**
- Files, Ask — Phase 6/7. The bucket filter is built generically enough for them to reuse, but
  nothing calls it from those surfaces yet.
- Billing gating on the number of shared buckets/collaborators — `US-ORG-04` is tier `Pro` per the
  PRD's scope table, but Phase 10 owns plan enforcement. This phase builds the feature for every
  account; Phase 10 adds the paywall.
- Real transactional email delivery in production — see §4.

## 4. Infrastructure gap: an `EmailProvider`

Invitations need to send an email. Following the exact pattern Phase 2 established for
`LlmProvider`/`StorageProvider` (`codebase-design`: small interface, swappable implementation):

```typescript
interface EmailProvider {
  send(params: { to: string; subject: string; html: string }): Promise<void>;
}
```

- **Stub implementation** (default, no env vars configured): logs the email via the structured
  logger and writes it to an in-memory array the test suite can assert against. This is what
  every Phase 3 test runs against — no real inbox needed to verify "an invite email goes out."
- **Real implementation**: gated behind `RESEND_API_KEY` (or `SMTP_*` vars) — picked the same way
  `getLlmProvider()` picks Anthropic/OpenAI vs. the stub based on which env var is present.

Without this seam, invitation tests would either need a real mail sandbox (slow, flaky, an
external dependency in CI) or the email-sending code would need to be untested — neither is
acceptable for a feature whose entire job is "notify someone."

## 5. Skills used, mapped to this phase

Extends the running table from Phase 1 §3 / Phase 2 §4 — only what's new or newly load-bearing:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Authorization middleware | `nodejs-backend-patterns` (middleware patterns) | The `authorize(...roles)` pattern this skill documents is exactly the shape `requireBucketRole()` needs — but parameterized per-bucket, not per-request-global, since the same user can be a viewer on one bucket and an owner on another |
| Domain vocabulary | `domain-modeling` | "Owner" vs. "member" vs. "viewer/editor," and what a bucket's `isDefault` and `parentId` actually guarantee, need pinning down before RBAC code is written — get "can a shared bucket be nested under a personal one?" wrong here and it's a data-integrity bug, not a UI bug |
| Module boundaries | `codebase-design` | `EmailProvider` is a deep-module seam exactly like Phase 2's providers; `requireBucketRole()` should be a deep piece of middleware (small call surface: `requireBucketRole('editor')`) hiding the membership lookup, not scattered `if` checks in every controller |
| Test-first | `tdd` | RBAC is the highest-consequence code this phase (a bug here leaks another user's data) — write "a viewer gets 403 on PATCH" as a red test before the middleware exists |
| Raw SQL / migrations | `prisma-client-api`, `prisma-cli` | Altering `Bucket` (adding `parentId`) after Phase 2 already shipped rows requires a real migration, not a schema rewrite — self-relations in Prisma have their own gotchas (`@relation("BucketToBucket")` naming) worth getting right the first time |
| Component structure | `vercel-composition-patterns` | A bucket **tree** (nestable) is a natural fit for a compound-component pattern (`BucketTree` owning expand/collapse state, `BucketTreeItem` recursing) rather than one component with a `depth` prop branching on itself |
| Reuse across surfaces | `vercel-react-best-practices` (`rerender-derived-state`, `rerender-split-combined-hooks`) | The bucket filter is explicitly required to be **one** shared implementation (`US-ORG-03` AC) — design its state (selected bucket, tree expansion) so Memory today and Files/Ask later subscribe to only what they need, not a monolithic context that re-renders everything on every filter change |
| Visual consistency | `frontend-design`, `ui-ux-pro-max` | A sidebar tree and role badges are new UI shapes — extend the existing notebook identity (cobalt accent for the active bucket, mono tags for role labels) rather than drifting |
| Accessibility | `web-design-guidelines` | New interaction patterns this phase — drag-and-drop or multi-select move, an invite-role picker, a nested/expandable tree — all need keyboard and screen-reader equivalents, which drag-and-drop in particular is easy to ship without |

## 6. Backend plan

### 6.1 Schema changes

```prisma
model Bucket {
  id        String    @id @default(cuid())
  userId    String    // the owner — creator, always role "owner", cannot leave/be removed
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  isDefault Boolean   @default(false)
  parentId  String?
  parent    Bucket?   @relation("BucketToBucket", fields: [parentId], references: [id], onDelete: SetNull)
  children  Bucket[]  @relation("BucketToBucket")
  createdAt DateTime  @default(now())
  memories  Memory[]
  members   BucketMember[]
  invites   BucketInvite[]

  @@index([userId])
  @@index([parentId])
}

model BucketMember {
  id         String   @id @default(cuid())
  bucketId   String
  bucket     Bucket   @relation(fields: [bucketId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       String   // "owner" | "editor" | "viewer" — the creator also gets an "owner" row,
                       // so membership lookup is always "does a BucketMember row exist", no
                       // separate ownership special-case in query code
  invitedAt  DateTime @default(now())
  acceptedAt DateTime?

  @@unique([bucketId, userId])
  @@index([userId])
}

model BucketInvite {
  id         String   @id @default(cuid())
  bucketId   String
  bucket     Bucket   @relation(fields: [bucketId], references: [id], onDelete: Cascade)
  email      String
  role       String   // "editor" | "viewer" — never "owner" via invite
  tokenHash  String   @unique
  invitedBy  String
  expiresAt  DateTime
  acceptedAt DateTime?
  createdAt  DateTime @default(now())

  @@index([bucketId])
  @@index([email])
}
```

Notes:
- The bucket creator gets a `BucketMember` row with role `"owner"` at creation time (in the same
  transaction) — this means every authorization check is one shape (`BucketMember` lookup), never
  "is this the bucket's `userId`, OR does a membership row exist."
  `Bucket.userId` still exists for quick "my buckets" queries and cascade-delete semantics, but is
  never consulted for authorization after this migration.
- `BucketInvite.tokenHash` follows the exact pattern `Session.refreshToken` already uses (Phase 1):
  a random token shown once (in the invite email), stored only hashed, verified via `sha256Hex()`
  from `shared/tokens.ts`.
- Deleting a bucket with children: `parentId` uses `onDelete: SetNull`, so deleting a parent
  promotes its children to top-level rather than cascading deletes through an entire subtree —
  losing a parent bucket should never silently delete grandchildren's memories.

### 6.2 Migration sequencing (existing data)

Two migrations, not one, mirroring Phase 2's backfill pattern:
1. Schema migration: add `parentId` to `Bucket`, create `BucketMember`/`BucketInvite`.
2. Backfill migration: `INSERT INTO "BucketMember" (bucketId, userId, role, acceptedAt) SELECT id,
   "userId", 'owner', "createdAt" FROM "Bucket"` — every bucket created before Phase 3 (i.e. every
   Phase 1/2 user's default bucket) gets its owner membership row, so the RBAC middleware doesn't
   have a gap for pre-existing data.

### 6.3 Services

- **`bucket.service.ts`** — `create()` (writes the owner `BucketMember` in the same transaction),
  `rename()`, `delete()` (rejects deleting `isDefault: true` — every account must always have
  somewhere memories can land; rejects if the bucket still has children — must be re-parented or
  deleted first, an explicit choice rather than a silent cascade), `list()` (returns the tree:
  every bucket the caller is a member of, with `role` attached per bucket), `move()` (re-parent).
- **`membership.service.ts`** — `invite()` (creates `BucketInvite`, calls `EmailProvider.send()`),
  `acceptInvite(token)` (validates hash + expiry, creates the `BucketMember` row, marks the invite
  accepted), `listMembers(bucketId)`, `changeRole()`, `remove()` (an owner can't remove themselves
  if they're the only owner — a bucket must always have at least one owner).
- **`bucket-access.ts`** (middleware) — `requireBucketRole(minRole: 'viewer' | 'editor' | 'owner')`
  reads `:bucketId` (or a `bucketId` in the body, for endpoints like memory-move that take it as a
  payload field) from the request, looks up the caller's `BucketMember` row, and rejects with 403
  if it doesn't exist or is below `minRole` in the ordering `viewer < editor < owner`. This is the
  one place role-comparison logic lives — every route calls the middleware, none re-implement the
  ordering.

### 6.4 Integrating with Phase 2's `memory.service.ts`

- `create()`/`update()`/`delete()`/`merge()` gain a `requireBucketRole('editor')` check (creating
  a memory targets a specific bucket now, not always the default) — a viewer must not be able to
  create, edit, delete, or merge in a bucket they can only view (`US-ORG-04` AC, extended from
  buckets themselves to the memories inside them, which is the entire point of sharing a bucket).
- `list()` gains an optional `bucketId` filter, using the exact same `requireBucketRole('viewer')`
  check other bucket-scoped reads use — this is the "one shared filter/behavior" `US-ORG-03`
  requires, implemented at the service layer so Files (Phase 6) and Ask (Phase 7) inherit the same
  guarantee by calling the same middleware, not by remembering to reimplement it.
- **Open question, resolved here rather than left implicit**: duplicate/stale
  `MemorySuggestion`s are currently scoped only by `userId` (Phase 2). In a shared bucket, should
  an editor see (and approve/dismiss) a suggestion that touches a memory they didn't create?
  **Decision:** yes — `suggestion.service.listPending()` gains a bucket-membership join, so a
  suggestion is visible to anyone with at least `viewer` access to the bucket the memory lives in,
  and actionable (`approve`/`dismiss`) by anyone with `editor`+. This matches the product intent of
  "shared context" — a suggestion about shared data shouldn't be invisible to collaborators — and
  is called out explicitly here so it isn't decided ad hoc mid-implementation.

### 6.5 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/buckets` | `US-ORG-01` |
| GET | `/api/buckets` (tree, with role per bucket) | `US-ORG-01`, `03` |
| PATCH | `/api/buckets/:id` (rename, move/re-parent) | `US-ORG-01`, `02` |
| DELETE | `/api/buckets/:id` | `US-ORG-01` |
| PATCH | `/api/memories/:id/bucket` (move a memory) | `US-ORG-02` |
| POST | `/api/buckets/:id/invites` | `US-ORG-04` |
| POST | `/api/invites/:token/accept` | `US-ORG-04` |
| GET | `/api/buckets/:id/members` | `US-ORG-04` |
| PATCH | `/api/buckets/:id/members/:userId` (role change) | `US-ORG-04` |
| DELETE | `/api/buckets/:id/members/:userId` | `US-ORG-04` |

### 6.6 Testing (`tdd`) — acceptance criteria as red tests first

1. Creating a bucket with just a name succeeds; the creator gets an `owner` membership row.
2. Renaming a bucket doesn't affect its contents or membership.
3. Deleting the default bucket is rejected; deleting a bucket with children is rejected until
   they're re-parented or removed.
4. An item (memory) belongs to exactly one bucket — moving it updates `bucketId` in place, never
   duplicates it.
5. The same bucket-filter code path is used for the Memory list (verified by asserting `list()`
   and a bucket-scoped read share the same authorization middleware, not by UI inspection).
6. Filtering by a bucket the caller has no membership in returns 403/empty, never another user's
   data, regardless of whether the bucket ID is guessed or enumerated.
7. Inviting by email creates a pending, unaccepted membership; the invited user has zero access
   until they accept (verified by attempting an authenticated call as that user pre-acceptance).
8. Accepting a valid invite creates an active membership with immediate access; an expired or
   already-used token is rejected.
9. A viewer attempting to edit/delete/merge a memory in a shared bucket gets 403 server-side, not
   just a hidden button.
10. An editor's change to a shared memory is visible to the owner and other members immediately,
    and is attributed to that member in `MemoryVersion.changedBy`.
11. Removing a member revokes their access on their very next request — no residual window (mirror
    Phase 1's session-revocation test pattern: revoke, then immediately retry as that member).
12. A bucket cannot end up with zero owners (removing the last owner, or an owner leaving, is
    rejected).

### 6.7 Backend exit criteria (unchanged from `Backend_Plan.md`)

A viewer-role member can read but not edit memories in a shared bucket; an editor can.

---

## 7. Frontend plan

### 7.1 Visual continuity

Same extension pattern as Phase 2 — no new tokens. New pattern introduced: **role badges**
(`Owner`/`Editor`/`Viewer`) as small `outline` badges next to a member's name, and the active
bucket in the sidebar tree gets the same `accent` treatment the active nav item already uses.

### 7.2 Screens & components

- **Bucket sidebar tree** — replaces the flat nav's implicit "one bucket" assumption. Built as a
  compound component (`vercel-composition-patterns`): `<BucketTree>` owns fetch + expand/collapse
  state, `<BucketTreeItem>` recurses over `children`, so adding drag targets or context menus later
  doesn't mean threading props through N levels.
- **Create/rename dialog** — reuses the Phase 1/2 `Dialog` primitive; delete requires confirming
  what happens to contents (matches `US-ORG-01` AC: never silently move-or-delete without asking).
- **Bucket filter** (`US-ORG-03`) — one component, `<BucketFilter>`, built once this phase and
  imported by the Memory list. It owns nothing about what it's filtering (memories today, files/
  Ask later) — it emits a selected `bucketId`, the consuming page's query key includes it.
- **Move UI** — a per-memory "Move to…" action (bucket picker) in the memory detail page and row
  menu; multi-select drag-and-drop is a `Could`-priority stretch, not a blocker, per
  `Frontend_Plan.md`'s "drag-and-drop **or** multi-select" phrasing.
- **Shared bucket UI**: invite-by-email form with a role selector, a pending-invite badge on
  not-yet-accepted rows, a member list with role-change (dropdown) and remove (confirm dialog) —
  gated to owners/editors in the UI, but the real enforcement is server-side (§6.4).

### 7.3 Data fetching

- `useBuckets()` — the tree, with each node's `role` attached, replacing the sidebar's currently
  hardcoded nav list for the Memories destination specifically (Chat History/Files/Ask/Settings
  stay flat nav items; only Memories gets bucket-aware).
- `useBucketMembers(bucketId)`, mutations for invite/accept/role-change/remove — same
  invalidate-on-success pattern established in Phase 1 (API keys) and Phase 2 (memories).
- `useMemories({ bucketId, q, cursor })` — Phase 2's hook gains the `bucketId` param, threaded from
  `<BucketFilter>`'s selection.

### 7.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A user can create a "Client A" bucket, move memories into it, and invite a teammate as an editor.

---

## 8. Delivery order (suggested)

1. **Backend:** schema migration (`parentId`, `BucketMember`, `BucketInvite`) + backfill migration
2. **Backend:** `bucket.service` CRUD/move + `bucket-access.ts` middleware, tests first
3. **Backend:** retrofit `memory.service.ts` with bucket-role checks + `bucketId` filter, tests
   first (this touches Phase 2 code — run Phase 2's existing suite alongside new tests to catch
   regressions)
4. **Backend:** `EmailProvider` (stub first, real implementation behind an env var) +
   `membership.service` (invite/accept/role/remove), tests first
4b. **Backend:** widen `duplicate-detection.service`/`stale-detection.service` to bucket-scoped
   candidates per §3.1, with a test seeding two different users' memories in the same shared
   bucket and asserting a suggestion is created across them
5. **Frontend:** `<BucketTree>` + create/rename/delete, wired into the sidebar for Memories
6. **Frontend:** `<BucketFilter>`, wired into the Memory list
7. **Frontend:** move UI, shared-bucket invite/member management UI
8. **Both:** run `code-review` and `web-design-guidelines` against this doc and the PRD; fix
   findings
9. Confirm both exit criteria (§6.7, §7.4) end-to-end, including the two-user RBAC scenario (needs
   two real accounts in the same bucket, not just one account's own data)

## 9. Alignment with Phase 4

Phase 4's retrieval engine (`Phase4_Implementation_Plan.md`) reads memories to build context for
a conversation. It must respect the exact same bucket-role boundary this phase establishes:
- Phase 4's retrieval query filters candidates through `requireBucketRole('viewer')` for whichever
  bucket(s) it's scoped to — it does not get its own, separate authorization logic.
- Phase 4's context-preview endpoint accepts an optional `bucketId`, and 403s under the same
  conditions `GET /api/memories?bucketId=` does here — one authorization story, not two.
- Categorization (Phase 4) runs per-memory, and a memory's bucket doesn't change its category —
  category is a property of content, not of organization, so Phase 4 has no reason to duplicate
  this phase's tree/membership model.

## 10. Traceability checklist

| Story | Covered by |
|---|---|
| US-ORG-01 | §6.1 Bucket model, §6.3 bucket.service, §6.5 bucket endpoints, §7.2 tree + dialog |
| US-ORG-02 | §6.3 bucket.service.move, §6.5 PATCH /api/memories/:id/bucket, §7.2 move UI |
| US-ORG-03 | §6.4 shared `bucketId` filter + middleware, §7.2 `<BucketFilter>` |
| US-ORG-04 | §6.1 BucketMember/BucketInvite, §6.3 membership.service, §6.5 invite endpoints, §7.2 shared bucket UI |

## 11. Definition of done

- [x] All Phase 3 endpoints in §6.5 implemented and covered by tests written per §6.6 (13 tests in
      `tests/bucket.test.ts`)
- [x] Phase 2's existing memory test suite still passes after the bucket-role retrofit (§6.4) —
      full backend suite is 57/57 green after the Phase 4 additions
- [x] Backend exit criteria (§6.7) demonstrated with two real accounts, not one account inspecting
      its own data — verified via a scripted two-account flow (owner invites guest as editor,
      guest 403s on the bucket before accepting) against the real running API
- [~] Frontend exit criteria (§7.4) demonstrated in a browser with a second real invited account —
      demonstrated the bucket nav, create/rename/delete dialogs, and move-memory UI live in a
      browser; the invite/accept round trip itself was verified at the API level (owner invites,
      guest 403s pre-accept) rather than clicking through two separate browser sessions — noted
      here rather than silently claimed as a full two-browser demo
- [x] `code-review`-equivalent scrutiny applied throughout (self-review caught and fixed the
      Prisma nested-write bucket-membership bug, the DRY `ROLE_RANK` duplication, and the 403-vs-404
      access-denied inconsistency); a dedicated `web-design-guidelines` pass was not run separately
- [x] The shared-suggestion-visibility decision in §6.4 is implemented exactly as decided
      (`suggestion.service.ts`'s `bucketRoleFor`/`requireSuggestionAccess`)
- [x] `docs/Phase4_Implementation_Plan.md` §9's dependency on this phase's RBAC middleware is
      re-verified — Phase 4's `/api/context/preview` route uses `optionalBucketRole('viewer')`
      directly, not a parallel check
- [x] §3.1's bucket-aware duplicate/stale detection widening is implemented and tested (see
      `duplicate-detection.service.ts`/`stale-detection.service.ts`'s bucket-scoped queries and
      `bucket.test.ts`'s cross-bucket duplicate-suggestion-visibility case) — done ahead of Phase 4,
      not left as a gap
