# Payments feature flag — `PAYMENTS_ENABLED`

One environment variable decides whether this deployment sells anything.

```bash
PAYMENTS_ENABLED=false   # or unset — the product runs FREE (default)
PAYMENTS_ENABLED=true    # Core/Pro plans, usage caps, and Stripe billing are active
```

Accepted truthy values: `true`, `1`, `yes`, `on` (case-insensitive). Anything else, including
unset or empty, means free.

## Why it defaults to off

A deployment that forgets the flag gives users too much rather than locking paying customers out
of features they can see in the UI. Self-hosted and internal instances — the common case for a
tool like this — get the free behaviour without needing to know the flag exists.

## What changes

| | `false` (free) | `true` (paid) |
|---|---|---|
| Knowledge graph, usage analytics, monthly insights | Available to everyone | Pro only, else `403 PRO_FEATURE` |
| Conversation history cap | Unlimited (`limit: null`) | 500 on Core |
| Shared bucket collaborators | Unlimited | 3 on Core |
| Precise search | Unlimited | 5 free previews on Core |
| Conversation summaries | Generated for everyone | Pro only |
| Category renaming | Everyone | Pro only |
| Knowledge-graph batch job | Runs for all accounts | Pro accounts only |
| `POST /api/billing/checkout`, `/portal`, `/webhook` | **404** — not mounted | Available |
| `GET /api/billing/summary` | Available, reports `paymentsEnabled: false` | Available |
| Trial-expiry scheduled job | Not registered | Registered |
| `account.subscription` | `{ plan: 'pro', status: 'active', trialEndsAt: null }` | The real subscription |
| Dashboard: Billing tab, trial banner, upgrade CTAs, locked cards | Hidden | Shown |
| `/pricing` | "Everything is included" | Core vs. Pro comparison |

## How it is implemented

`backend/src/shared/entitlements.ts` is the **single chokepoint**. Every plan gate, usage cap, and
Pro-only job asks it rather than reading `Subscription.plan` directly:

- `isEntitled(userId)` — always `true` when payments are off; otherwise reads the subscription.
- `capFor(userId, coreLimit)` — returns `null` (unlimited) for entitled accounts and free deployments.
- `entitledUserIds()` — every user when free, Pro users when paid. Used by batch jobs.
- `paymentsEnabled()` — the raw flag, for the few places that need the deployment mode itself.

`requirePlan()` / `assertPlan()` / `hasPlan()` all delegate to `isEntitled()`, so the middleware
and every existing call site inherit the behaviour with no changes of their own.

This matters: "free" has to mean free *everywhere*. A gate that kept its own copy of the check
would keep charging for one feature after the flag was flipped, and nothing would catch it. Before
this change, nine separate sites decided entitlement independently — three of them by querying
`Subscription` directly.

The frontend never reads an env var for this. The server sends `paymentsEnabled` on
`/api/account/me` and `/api/billing/summary`, so the UI and the enforcement can never disagree.

## Tests

`backend/tests/payments-flag.test.ts` covers both modes — 12 tests asserting that free unlocks
every gate and 404s the billing surface, and that paid still gates, caps, and sells.

The rest of the suite runs with `PAYMENTS_ENABLED=true` (set in `tests/env.setup.ts`) because
every pre-existing test asserts paid-product behaviour, and that must keep being exercised.

## Switching a live deployment

Flipping to `false` takes effect on restart. Nothing is destroyed: `Subscription`, `Payment`, and
`ProcessedWebhookEvent` rows are left untouched and simply stop being consulted, so flipping back
to `true` restores every account to the plan it had.

Cancel active Stripe subscriptions before going free — this flag stops the app from *reading*
plans, it does not stop Stripe from *billing* anyone.
