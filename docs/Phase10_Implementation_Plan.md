# Phase 10 Implementation Plan — Billing, Plans & Monetization

**Source documents:** `Product_Requirements.md` §7.9 (`US-BIL-01`–`04`), `Backend_Plan.md` Phase 10,
`Frontend_Plan.md` Phase 10
**Companion document:** `Phase9_Implementation_Plan.md` §9 — this phase's `requirePlan()`
middleware is the generalization of a check that has been written inline, ad hoc, three times
already (`historyLimitService`, Phase 9's graph/analytics gates) before this phase even exists.
This document's central job is collecting every deferred Pro-gate this codebase has been
explicitly tracking since Phase 3 and enforcing them for real, in one place.

---

## 1. Objective

> Downgrading a test account immediately restricts Pro-only endpoints; Stripe webhook failures
> are retried and logged, not silently dropped (backend exit criteria). A Core user hitting a
> Pro-only feature sees a clear, non-blocking upgrade path (frontend exit criteria).

Every prior phase that touched a Pro-tier feature left a comment pointing here. This phase is
where those comments get resolved, not where new product surface gets built.

## 2. What already exists vs. what's net-new

| Capability | Status |
|---|---|
| `Subscription` model (`plan`, `status`, `trialEndsAt`, `stripeIds`) | **Exists** (Phase 1) — the schema already anticipated this phase; no migration needed to add the core fields, only to add what billing *events* need (§5.1) |
| Server-side trial computation | **Exists** (Phase 1) — `auth.service.ts` computes `trialEndsAt` as `now + TRIAL_DAYS` at registration, not editable client-side. `US-BIL-03`'s trial half is **already done** |
| `historyLimitService`'s plan-check shape | **Exists** (Phase 5) — `requirePlan()` (§4) is this exact check, generalized into reusable middleware |
| `TrialBanner` (read-only) | **Exists** (Phase 1) — explicitly documented there as "real limit enforcement and upgrade flows are Phase 10, this banner only has to tell the truth about current state." This phase is that follow-through |
| `requireScope()` middleware shape | **Exists** (Phase 8) — `requirePlan()` mirrors it exactly: a no-op when the check doesn't apply, a clear 403 with a specific code when it does |
| Every phase's deferred Pro-gate | **Exists as an explicit, tracked comment** (§3's retrofit table) — not a search-and-guess exercise, a literal checklist already written into the codebase by the phases that deferred them |
| Stripe integration (checkout, webhooks, real payment records) | **Net-new** — nothing before this phase has needed real money to move |
| Refund-eligibility computation | **Net-new** — `US-BIL-03`'s 14-day refund window needs an actual purchase timestamp, which doesn't exist until a real payment record does |

## 3. In scope / out of scope

**In scope**
- **Stripe integration**: hosted checkout session creation, webhook handling for subscription
  lifecycle events (created/updated/canceled, payment succeeded/failed)
- **`requirePlan()` middleware**: the one place Pro-gating logic lives, mirroring `requireScope`'s
  shape
- **The retrofit**: applying `requirePlan('pro')` to every already-shipped-open Pro feature this
  codebase has been tracking since Phase 3 (table below) — this is the concrete, checkable
  deliverable this phase's own exit criteria demands ("downgrading a test account immediately
  restricts Pro-only endpoints" is meaningless unless every one of these is actually gated)
- **Trial expiry enforcement**: a scheduled job (reusing `JobRunner`) that transitions a
  `trialing` subscription past `trialEndsAt` to a real state, not an indefinitely-`trialing` row
- **Refund-eligibility computation**: server-side, from a real `Payment.paidAt` timestamp
- **Usage metering surfacing**: exposing the counts that already exist (`historyLimitService.usage()`,
  Phase 9's `UsageAnalyticsSummary`) through a billing-facing endpoint for the pricing/usage UI
- Frontend: pricing/comparison page, checkout embed, upgrade/downgrade flow, trial countdown
  banner (replacing the read-only one), usage-limit warnings, billing/invoice history, feature-gate
  locked-state cards

**Explicitly out of scope this phase**
- **Metered/usage-based billing** (charging per-API-call, per-token, etc.) — the PRD's plan model
  is flat-rate Core/Pro tiers; nothing in `US-BIL-01`–`04` asks for usage-based pricing
- **Multi-seat/team billing** (one subscription covering several users) — every `Subscription` row
  is per-user, matching the schema Phase 1 already committed to; team billing would be a schema
  change this phase doesn't make
- **Tax calculation, invoicing customization, dunning email sequences beyond Stripe's defaults** —
  Stripe's hosted checkout and Billing Portal handle the baseline; building custom versions of
  what Stripe already provides isn't this phase's job
- **Coupon/promo code system** — not in the PRD's billing user stories; a real feature request
  worth its own scoping later, not assumed here

**Retrofit table — every Pro-gate this phase must close, not discover:**

| Feature | Where it was built open | PRD story | Gate to apply |
|---|---|---|---|
| Shared buckets beyond a cap | Phase 3 (`US-ORG-04`, Tier: Pro) | Shared buckets are Must/Pro but currently work for any plan | `requirePlan('pro')` on invite creation past N free collaborators (a cap, not zero — see §5.2) |
| Full category tuning | Phase 4 (`US-ADV-01`, Core basic / Pro full) | Core gets basic Smart Memory, Pro gets full category tuning | `requirePlan('pro')` on category-rename/management endpoints; basic on/off toggle stays Core |
| Conversation summaries | Phase 5 (`US-ARC-05`, Tier: Pro) | Runs for every plan today | `requirePlan('pro')` before `summary.service.summarize()` fires |
| Monthly insights | Phase 5 (`US-ARC-06`, Tier: Pro) | Runs for every plan today | `requirePlan('pro')` in `insight.service.generateForUser()` and its read endpoint |
| High-accuracy recall (precise search mode) | Phase 5 (`US-ARC-07`, Pro / preview on Core) | `mode: 'precise'` works for every plan today | Core gets a capped number of precise queries (a "preview," per the PRD's own tier note) before `requirePlan('pro')` blocks further use — not an outright block, matching the PRD's explicit "preview may be available on Core" |
| Conversation history limit | Phase 5 (`US-ARC-08`) | **Already correctly gated** — `historyLimitService` | No change; this phase's `requirePlan()` should eventually replace its inline check for consistency, not because it's currently wrong |
| Knowledge graph, usage analytics | Phase 9 (`US-ADV-02`/`03`) | Built gated from day one (Phase 9 §4) | Replace Phase 9's inline check with `requirePlan()` — a refactor, not a new gate |

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| `PaymentProvider` interface | Stripe is a real external dependency needing the same swappable-seam treatment every other integration point has gotten | `{ createCheckoutSession(userId, plan), createBillingPortalSession(userId), verifyWebhookSignature(payload, signature) }` — a stub implementation for dev/test (returns a fake session URL, accepts any webhook payload unsigned) so the full plan-gating logic is testable without real Stripe API calls or test-mode keys, same "stub path exercises the contract" bar every provider in this codebase has met |
| `requirePlan()` middleware | The one place Pro-gating logic should live, replacing N inline copies | Mirrors `requireScope()` exactly: `requirePlan('pro')` returns middleware checking `req.auth.userId`'s `Subscription.plan`, 403s `PRO_FEATURE` with an upgrade-path message if not met. Works for both session and API-key auth (unlike `requireScope`, which only constrains keys) — plan is a property of the *account*, not of how this particular request authenticated |
| Idempotent webhook handling | Stripe retries webhooks on any non-2xx response; the same event can arrive more than once | Each webhook's Stripe event `id` is checked against a `ProcessedWebhookEvent` table before handling — the exact idempotency-key discipline Phase 5's `Conversation` upsert and Phase 8's pairing `deliveredKey` already established, applied to a third kind of at-least-once delivery |
| Trial-expiry job | Nothing currently transitions a `trialing` subscription once `trialEndsAt` passes | `JobRunner`-scheduled (Phase 5's seam), daily: any `trialing` subscription past `trialEndsAt` becomes `status: 'expired'` (Core-tier behavior applies from that point; this is a status transition, not a forced downgrade of `plan` — a user who never picks a plan simply reverts to what Core already allows) |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model Payment {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripePaymentId String @unique
  amountCents Int
  currency   String   @default("usd")
  status     String   // "succeeded" | "failed" | "refunded"
  paidAt     DateTime
  refundEligibleUntil DateTime // paidAt + 14 days, computed server-side at write time

  @@index([userId])
}

model ProcessedWebhookEvent {
  id          String   @id @default(cuid())
  stripeEventId String @unique
  processedAt DateTime @default(now())
}
```

`Subscription` needs no new columns — `plan`/`status`/`trialEndsAt`/`stripeIds` (already `Json?`
for the Stripe customer/subscription IDs) cover this phase's needs exactly as Phase 1 anticipated.

### 5.2 Services

- **`billing.service.ts`**
  - `createCheckoutSession(userId, plan: 'pro')`: via `PaymentProvider`, returns the hosted
    checkout URL. Upgrade takes effect on the webhook confirming payment, not on session creation
    (`US-BIL-02`'s "upgrade takes effect immediately" means immediately-on-confirmed-payment, not
    immediately-on-clicking-checkout).
  - `createBillingPortalSession(userId)`: Stripe's hosted portal for plan changes/cancellation —
    downgrade is scheduled for period-end by Stripe's own subscription-cancel-at-period-end
    behavior, not custom logic this codebase reimplements (`US-BIL-02`'s downgrade AC).
  - `handleWebhook(payload, signature)`: verifies signature via `PaymentProvider`, checks
    `ProcessedWebhookEvent` for the event id (idempotent no-op if already processed), updates
    `Subscription.plan`/`status`/`stripeIds` accordingly, records a `Payment` row on successful
    charge with `refundEligibleUntil` computed from `paidAt` at write time. On a handler error,
    rethrows (uncaught) so the webhook endpoint returns non-2xx and Stripe retries — "failures are
    retried and logged, not silently dropped" is only true if a failure doesn't get swallowed into
    a 200.
  - `getUsageAndBilling(userId)`: assembles the pricing/usage page's data — current plan, trial
    status, `historyLimitService.usage()`, and Phase 9's `UsageAnalyticsSummary` if Pro — one read
    endpoint instead of the frontend calling four.

- **`shared/requirePlan.ts`** — the middleware itself (§4), plus a small `assertPlan(userId,
  plan)` service-level function for the handful of call sites that need the check outside an HTTP
  route (e.g. `summary.service.summarize()` before it fires) — the same "route middleware AND
  service-level self-defense" pattern `bucketAccess.ts` established for buckets.

- **`trial-expiry.service.ts`** — the `JobRunner`-scheduled job (§4).

### 5.3 Endpoints

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/billing/checkout` (`{ plan: 'pro' }`) | `US-BIL-02` |
| POST | `/api/billing/portal` | `US-BIL-02` (downgrade/cancel) |
| POST | `/api/billing/webhook` (Stripe signature header, unauthenticated — verified by signature, not a session) | `US-BIL-03` |
| GET | `/api/billing/summary` | `US-BIL-01`, `US-BIL-04` |

Plus the retrofit (§3's table): `requirePlan('pro')` added to the specific existing routes/service
calls named there — not new endpoints, changes to existing ones.

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. A webhook confirming payment upgrades `Subscription.plan` to `'pro'` and the very next request
   to a `requirePlan('pro')`-gated endpoint succeeds — no delay, no cache to invalidate.
2. The same Stripe webhook event delivered twice (same event id) only applies its effect once —
   the core idempotency test this phase exists to make pass for webhooks specifically.
3. A webhook handler that throws mid-processing results in a non-2xx response (so Stripe retries)
   and the failure is logged — proving "not silently dropped," not just asserting a status code.
4. Downgrading (via a canceled-subscription webhook) immediately 403s every retrofitted endpoint
   in §3's table for that user, on their very next request — the literal backend exit criteria.
5. A Core user hitting any of §3's retrofitted features gets `403 PRO_FEATURE` with an upgrade-path
   message in the response body, never a generic error or silent empty result.
6. Refund eligibility: a `Payment` 13 days old is refund-eligible; one 15 days old is not — computed
   from `paidAt`, not from "now minus a hardcoded window" evaluated at read time (which would drift
   as time passes in a way the stored `refundEligibleUntil` doesn't).
7. A `trialing` subscription past `trialEndsAt`, after the trial-expiry job runs, has
   `status: 'expired'` and is treated as Core-tier by every `requirePlan('pro')` check.
8. The stub `PaymentProvider` exercises every method above without a real Stripe test-mode key
   configured — proving the whole flow is testable in CI, same bar every other provider meets.

### 5.5 Backend exit criteria (unchanged from `Backend_Plan.md`)

Downgrading a test account immediately restricts Pro-only endpoints; Stripe webhook failures are
retried and logged, not silently dropped.

---

## 6. Frontend plan

### 6.1 Where this lives

New `/pricing` (public, unauthenticated) and `/dashboard/settings/billing` (authenticated),
replacing `TrialBanner`'s read-only-only role with a real upgrade CTA.

### 6.2 Screens & components

- **Pricing page** — Core vs. Pro comparison table. `US-BIL-01`'s AC is explicit: this table and
  the actual `requirePlan()` gates (§3) must never disagree — generated from the same retrofit
  table (§3) as a single source of truth in the codebase, not hand-maintained copy that drifts
  from what the backend actually enforces.
- **Checkout** — Stripe-hosted checkout embed/redirect via `POST /api/billing/checkout`.
- **Trial countdown banner** — replaces Phase 1's read-only `TrialBanner` with one that links to
  the pricing page and reflects real expiry-job state (`status: 'expired'`), not just a
  days-remaining count that goes stale after expiry.
- **Usage-limit warnings** — "approaching the 500-conversation cap" style banners, sourced from
  `historyLimitService.usage()`'s real numbers (already returned, Phase 5), not a guessed
  threshold.
- **Billing/invoice history** — a simple list from Stripe's Billing Portal (embedded or
  deep-linked via `POST /api/billing/portal`) rather than a custom invoice UI this codebase would
  have to keep in sync with Stripe's own records.
- **Locked-state cards** — the same pattern Phase 9 previewed statically (§6.2 there) now wired to
  a real "Upgrade" button that opens checkout — Phase 9's placeholder becomes functional here, not
  rebuilt.

### 6.3 Data fetching

- `useBillingSummary()`, `useCheckout()`, `useBillingPortal()` — standard query/mutation shapes,
  nothing new architecturally.

### 6.4 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

A Core user hitting a Pro-only feature sees a clear, non-blocking upgrade path.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3 … Phase 9 §7) — only what's new:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| New provider seam | `codebase-design` | `PaymentProvider` is the ninth provider-family addition in this codebase (`LlmProvider`, `StorageProvider`, `EmailProvider`, `CacheProvider`, `JobRunner`, `ConversationImportProvider`, `DocumentParser`, now this) — proof the pattern generalizes to genuinely external, money-moving dependencies too, not just internal abstractions |
| Idempotent webhook handling | `nodejs-backend-patterns`, `prisma-client-api` | Webhooks are the highest-stakes at-least-once-delivery surface this codebase has built yet (real money, real plan state) — the same idempotency-key discipline as Phase 5/8, applied where getting it wrong actually costs someone a subscription or a duplicate charge record |
| Security review | `security-review` | Webhook signature verification, and making sure `requirePlan()` truly cannot be bypassed by calling the API directly (`US-BIL-04`'s explicit AC) — this phase is the first to move real payment data and deserves a dedicated adversarial pass, not just the standard `code-review` |
| Test-first | `tdd` | "Downgrade takes effect on the very next request" and "the same webhook twice only applies once" are exactly the silently-wrong-under-a-retry code this discipline exists for |
| Retrofit discipline | `domain-modeling` | The retrofit table (§3) had to be assembled by reading every prior phase's own deferred-gating comments precisely — getting one wrong (gating something meant to stay free, or missing one meant to be gated) is a real product/revenue bug, not a cosmetic one |
| Visual consistency | `frontend-design`, `web-design-guidelines` | The pricing page and locked-state cards are the most commercially visible new screens yet — must read as trustworthy and consistent with the notebook identity, not a bolted-on SaaS-template checkout flow |

## 8. Delivery order (suggested)

1. **Backend infra:** `PaymentProvider` interface + stub; `Payment`/`ProcessedWebhookEvent` schema
2. **Backend:** `requirePlan()` middleware + `assertPlan()`, tests first (403/200 shape, session
   vs. API-key both respected)
3. **Backend:** `billing.service`'s checkout/portal/webhook handling, tests first (idempotency,
   retry-on-failure)
4. **Backend:** the retrofit — apply `requirePlan('pro')` to every row in §3's table, one at a
   time, confirming each with its own test before moving to the next (not a single sweeping
   change that's hard to review)
5. **Backend:** `trial-expiry.service` (`JobRunner`-scheduled), tests first
6. **Backend:** endpoints; full Phase 1–9 regression suite green
7. **Frontend:** pricing page generated from the same retrofit-table source the backend enforces
8. **Frontend:** checkout flow, billing history, real trial banner, usage warnings, locked-state
   CTAs wired to checkout
9. **Both:** `security-review` (webhook verification, gate-bypass attempts) and `code-review`/
   `web-design-guidelines` passes; confirm exit criteria with Stripe test-mode webhooks, not just
   the stub provider

## 9. Alignment with Phase 9

- **The retrofit (§3) closes Phase 9's own stopgap.** Phase 9 §9 explicitly flagged its inline
  `subscription.plan === 'pro'` checks as temporary. This phase's step 4 (delivery order) replaces
  them with `requirePlan()` — a deletion of duplicate logic, not new gating.
- **Usage metering can read Phase 9's event log, selectively.** `historyLimitService.usage()`
  stays a direct count (already correct, simplest for that one metric); `getUsageAndBilling()`
  reads Phase 9's `UsageAnalyticsSummary` for the richer metrics — this phase doesn't force every
  metric through one mechanism where a simpler one already works.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Pricing and plan comparison (`US-BIL-01`) | §6.2 pricing page, generated from §3's retrofit table |
| Upgrade and downgrade (`US-BIL-02`) | §5.2 `billing.service` checkout/portal |
| Trial and refund enforcement (`US-BIL-03`) | §5.1 `Payment.refundEligibleUntil`, §4 trial-expiry job |
| Feature gating for Pro-only capabilities (`US-BIL-04`) | §4 `requirePlan()`, §3 retrofit table |

## 11. Definition of done

- [ ] All Phase 10 endpoints in §5.3 implemented and covered by tests written per §5.4
- [ ] Every row in §3's retrofit table is actually gated — verified one by one, not assumed from
      the table existing
- [ ] Phase 1–9's existing test suite still passes unmodified except for the retrofitted
      endpoints' own tests, which are expected to change (a Core-plan test scenario that used to
      succeed on a now-gated endpoint must be updated to expect 403, not left red)
- [ ] Backend exit criteria (§5.5) demonstrated with real Stripe test-mode webhooks (checkout →
      webhook → plan upgrade → gated endpoint unlocks; cancel → webhook → plan downgrade → gated
      endpoint 403s on the very next request)
- [ ] Frontend exit criteria (§6.4) demonstrated live: a Core account hits a locked feature, sees
      the upgrade CTA, completes checkout, and the feature unlocks without a page reload requiring
      a manual refresh to notice
- [ ] `security-review` run specifically against webhook verification and `requirePlan()`
      bypass attempts (calling the gated API directly with a Core-plan session/key), in addition
      to the standard `code-review`/`web-design-guidelines` passes
- [ ] The pricing page's feature list and the actual `requirePlan()` gate set are confirmed to
      match, checked against §3's table as the single source of truth, not eyeballed
