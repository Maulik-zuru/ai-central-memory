# Phase 1 Implementation Plan — Accounts, Auth & API/Dashboard Foundations

**Source documents:** `Product_Requirements.md` (§7.1, epics `US-ACC-01`…`US-ACC-08`),
`Backend_Plan.md` (Phase 1), `Frontend_Plan.md` (Phase 1)
**Scope:** the first vertical slice of the AI Memory & Context Platform — no memory/bucket/archive
features yet. Phase 1 exists so a real user can register, authenticate, manage an API key, and land on
a working (mostly empty) dashboard, on top of infra assumed done in Phase 0.

---

## 1. Objective

> A registered user can authenticate via session **and** via a generated API key against a protected
> test endpoint (backend exit criteria), and can register, log in, generate an API key, and see a
> stable dashboard shell (frontend exit criteria).

Everything below is scoped to make that statement true and traceable to `US-ACC-01` through
`US-ACC-08`.

## 2. In scope / out of scope

**In scope this phase**
- Email/password auth + Google OAuth (`US-ACC-01`)
- JWT access+refresh session handling
- API key issuance, naming, revocation, last-used tracking (`US-ACC-03`)
- `Subscription` model skeleton (plan field only — no billing logic; that's Phase 10)
- Rate limiting middleware (per-user, per-key)
- Audit log write-path (used by every later phase)
- Dashboard shell + nav + account/profile settings + empty states (`US-ACC-02`)
- Plan/trial visibility banner — schema + read-only display only (`US-ACC-04`, real limits land Phase 10)
- Consent-toggle UI scaffold and session/device list UI scaffold (`US-ACC-07`, `US-ACC-08`) — full
  enforcement logic can follow in later phases once there's real data to gate

**Explicitly out of scope this phase** (belongs to later phases per the plans)
- Memory, buckets, chat archive, files, Ask — Phases 2–7
- Real Stripe billing / plan gating — Phase 10
- Data export / deletion pipelines — Phase 11 (`US-ACC-05`, `US-ACC-06` UI can be stubbed as
  "coming soon" links, not built end-to-end here)

## 3. Skills available in this repo, mapped to this phase

The repo already has these skills installed under `.agents/skills/`. Use them **in this order of
priority** while implementing — don't reinvent guidance they already cover.

| Area | Skill | When to invoke it in Phase 1 |
|---|---|---|
| Domain modeling | `domain-modeling` | Before writing `schema.prisma` — pin down what "User," "Session," "ApiKey," "Subscription," "AuditLog" mean precisely, so backend and frontend share vocabulary |
| Module design | `codebase-design` | When designing the `auth` and `apikey` service interfaces — keep them deep modules (small interface, real logic hidden), not thin CRUD wrappers leaking Prisma types |
| DB setup | `prisma-postgres-setup` | First — provisioning the Postgres DB + connection string if not already done in Phase 0 |
| DB config | `prisma-database-setup` | Confirming/adjusting the Postgres provider config in `schema.prisma` |
| Schema/CLI workflow | `prisma-cli` | `prisma init`, `prisma migrate dev`, `prisma studio` while iterating on the auth schema |
| Queries | `prisma-client-api` | Writing the actual `User`/`ApiKey`/`Subscription`/`AuditLog` CRUD in the service layer |
| Backend architecture | `nodejs-backend-patterns` | Express middleware structure: auth middleware, error handler, rate limiter, route→controller→service layering |
| Backend judgment calls | `nodejs-best-practices` | Deciding auth patterns (JWT rotation, password hashing cost factor, async error handling) — think, don't copy-paste |
| Test-first | `tdd` | Auth is the highest-consequence code in the system — write the red test (e.g. "revoked key fails immediately") before the implementation |
| UI components | `shadcn` | Building the login/signup forms, dashboard shell nav, settings page components |
| Visual direction | `frontend-design` / `high-end-visual-design` | One pass, up front, to pick a deliberate visual identity for the dashboard shell so Phase 2+ don't inherit generic AI-template look |
| UI/UX reference | `ui-ux-pro-max` | Look up concrete color palette / font pairing / UX guideline choices for a SaaS dashboard product type |
| React architecture | `vercel-composition-patterns` | Structuring the dashboard shell (nav, account menu, empty-state slots) as composable components, not prop-boolean soup |
| React perf | `vercel-react-best-practices` | Data fetching pattern for session/user state, avoiding unnecessary client-side re-renders in the shell |
| Review | `code-review` | Run after each vertical slice (backend auth, then API keys, then dashboard shell) against this doc as the spec |
| Debugging | `diagnosing-bugs` | If auth/session behavior misbehaves (e.g. token refresh race, revoked-key still working) — don't guess-patch |
| Writing this doc / future skill docs | `writing-for-agents` | Already applied to this file's structure |

No Prisma-adapter or upgrade-specific skills (`prisma-driver-adapter-implementation`,
`prisma-upgrade-v7`) are relevant yet — those matter only if we're implementing a custom driver
adapter or migrating an existing v6 project, neither of which applies to a fresh Phase 0/1 build.

---

## 4. Backend Plan

### 4.1 Data model (Phase 1 slice of `Backend_Plan.md` §4)

Use `domain-modeling` to confirm field-level meaning before migrating, then `prisma-cli` to scaffold:

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String?
  oauthGoogleId String?  @unique
  planId        String   @default("core")
  createdAt     DateTime @default(now())
  apiKeys       ApiKey[]
  subscription  Subscription?
  auditLogs     AuditLog[]
  sessions      Session[]
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  refreshToken String   @unique
  userAgent    String?
  ipAddress    String?
  lastActiveAt DateTime @default(now())
  revokedAt    DateTime?
  createdAt    DateTime @default(now())
}

model ApiKey {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  name       String
  keyHash    String   @unique
  scopes     String[]
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime @default(now())
}

model Subscription {
  id            String   @id @default(cuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id])
  plan          String   @default("core") // "core" | "pro" — enforcement is Phase 10
  status        String   @default("trialing")
  trialEndsAt   DateTime?
  stripeIds     Json?    // populated in Phase 10, nullable now
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  action     String
  targetType String?
  targetId   String?
  occurredAt DateTime @default(now())
}
```

Run via `prisma-cli`: `prisma migrate dev --name phase1-accounts-auth`.

### 4.2 Services (`codebase-design` — keep these deep, not thin CRUD)

- `auth.service.ts` — register, login, refresh, logout, Google OAuth callback. Hides: password
  hashing, token signing/verification, session persistence. Exposes: `register()`, `login()`,
  `refresh()`, `logout()`, `loginWithGoogle()`.
- `apiKey.service.ts` — issue (returns raw key once, stores hash), list, revoke, touch-last-used.
  Exposes: `issue()`, `list()`, `revoke()`.
- `audit.service.ts` — single `record(userId, action, target?)` call, used by every other service
  from this phase onward.
- `session.service.ts` — list active sessions for a user, revoke one by id.

### 4.3 Middleware (`nodejs-backend-patterns`)

- `authenticate` — accepts either a valid session JWT or a valid `Authorization: Bearer <apiKey>`;
  attaches `req.user` either way so downstream code doesn't care which auth method was used.
- `rateLimit` — per-user and per-key, Redis-backed (infra from Phase 0).
- `errorHandler` — central Express error middleware, consistent error shape across the API.

### 4.4 Endpoints (Phase 1 surface)

| Method | Path | Maps to |
|---|---|---|
| POST | `/api/auth/register` | `US-ACC-01` |
| POST | `/api/auth/login` | `US-ACC-01` |
| GET | `/api/auth/google/callback` | `US-ACC-01` |
| POST | `/api/auth/refresh` | session handling |
| POST | `/api/auth/logout` | `US-ACC-08` |
| GET | `/api/account/me` | `US-ACC-02`, `US-ACC-04` |
| GET | `/api/account/sessions` | `US-ACC-08` |
| DELETE | `/api/account/sessions/:id` | `US-ACC-08` |
| POST | `/api/keys` | `US-ACC-03` |
| GET | `/api/keys` | `US-ACC-03` |
| DELETE | `/api/keys/:id` | `US-ACC-03` |
| GET | `/api/health` (or reused from Phase 0) | protected-endpoint proof for exit criteria |

### 4.5 Testing (`tdd`)

Write these as **red tests first**, matching PRD acceptance criteria directly:
1. Registering with an existing email fails with a clear, non-leaking error (`US-ACC-01`).
2. A revoked API key fails auth on the **very next** request, not after a cache window (`US-ACC-03`).
3. A generated API key is shown once; re-fetching the key list never returns the raw key again
   (`US-ACC-03`).
4. Revoking a session invalidates it within the same request cycle (`US-ACC-08`).
5. Every register/login/key-issue/key-revoke/session-revoke call produces exactly one `AuditLog` row.

### 4.6 Backend exit criteria (unchanged from `Backend_Plan.md`)

A registered user can authenticate via session and via a generated API key against `/api/account/me`
or an equivalent protected test endpoint.

---

## 5. Frontend Plan

### 5.1 Visual direction (do this once, first)

Before building screens, spend one focused pass with `frontend-design` (or `high-end-visual-design`
if the bar is "should feel expensive") plus `ui-ux-pro-max` to pick: a color palette, a font pairing,
and the dashboard's overall visual identity (spacing scale, card style, shadow depth). Lock these into
the Tailwind/shadcn theme config so every later phase (2–12) inherits one consistent system instead of
drifting screen to screen.

### 5.2 Screens & components (`shadcn` for primitives, `vercel-composition-patterns` for structure)

- **Auth pages:** Sign up, Log in, Forgot password — `US-ACC-01`. Use shadcn `Form`, `Input`,
  `Button`, `Card`. Google OAuth button triggers the backend callback route.
- **Dashboard shell:** left nav (Memories / Chat History / Files / Ask / Buckets / Settings — all but
  Settings render an empty state this phase), top bar, account menu — `US-ACC-02`. Build the nav and
  empty-state slot as composable primitives (a `<Shell>` layout + `<NavItem>` + `<EmptyState>`) per
  `vercel-composition-patterns`, since every future phase adds a section to this same shell.
- **Account & profile settings page** — name/email display, password change, connected Google account
  status.
- **API key management UI** (`US-ACC-03`): generate (name input → modal shows the raw key once with a
  copy button and an explicit "you won't see this again" warning), list (name, masked key, last-used,
  created), revoke (confirm dialog).
- **Plan/trial banner** (`US-ACC-04`): read-only display of `Subscription.plan` and
  `trialEndsAt` from `/api/account/me` — no upgrade flow yet (Phase 10).
- **Privacy/consent toggle scaffold** (`US-ACC-07`): a Settings sub-section with per-platform toggles
  wired to a stub endpoint; full auto-capture behavior doesn't exist until Phase 2, so this just
  proves the control surface exists and persists.
- **Session/device management** (`US-ACC-08`): list from `GET /api/account/sessions`, revoke button
  per row calling `DELETE /api/account/sessions/:id`.

### 5.3 Data fetching (`vercel-react-best-practices`)

- TanStack Query for all server state (`useSession`, `useApiKeys`, `useSessions`); Zustand only for
  local UI state (e.g. "create key" modal open/closed).
- Invalidate the API-key list query on issue/revoke instead of manual cache patching, to avoid stale
  "revoked but still shown" bugs that would fail `US-ACC-03`'s acceptance criteria.

### 5.4 Empty states (`US-ACC-02`)

Every nav destination beyond Settings (Memories, Chat History, Files, Ask, Buckets) needs a real
empty-state component this phase — "not built yet, here's what will go here" — so the shell never
feels broken navigating around it, per the frontend exit criteria.

### 5.5 Frontend exit criteria (unchanged from `Frontend_Plan.md`)

New user can register, log in, generate an API key, and see a stable shell.

---

## 6. Delivery order (suggested)

1. **Backend:** schema + migration (`prisma-postgres-setup` → `prisma-database-setup` → `prisma-cli`)
2. **Backend:** `auth.service` + register/login/refresh/logout endpoints, tests first (`tdd`)
3. **Backend:** `apiKey.service` + endpoints, tests first
4. **Backend:** `audit.service` wired into all of the above; `session.service` + endpoints
5. **Backend:** rate-limit + error-handler middleware, Google OAuth callback
6. **Frontend:** visual direction pass, theme tokens locked
7. **Frontend:** auth pages wired to backend
8. **Frontend:** dashboard shell + nav + empty states
9. **Frontend:** account settings, API key UI, plan banner, session list, consent scaffold
10. **Both:** run `code-review` against this doc as the spec; fix findings
11. Confirm both exit criteria (§4.6, §5.5) end-to-end before calling Phase 1 done

## 7. Traceability checklist

| Story | Covered by |
|---|---|
| US-ACC-01 | §4.1 User model, §4.2 auth.service, §4.4 auth endpoints, §5.2 auth pages |
| US-ACC-02 | §5.2 dashboard shell, §5.4 empty states |
| US-ACC-03 | §4.1 ApiKey model, §4.2 apiKey.service, §4.4 key endpoints, §5.2 API key UI |
| US-ACC-04 | §4.1 Subscription model, §5.2 plan banner (read-only) |
| US-ACC-05 | Explicitly deferred to Phase 11 — not built this phase |
| US-ACC-06 | Explicitly deferred to Phase 11 — not built this phase |
| US-ACC-07 | §5.2 consent scaffold (control surface only, not full enforcement) |
| US-ACC-08 | §4.1 Session model, §4.2 session.service, §4.4 session endpoints, §5.2 session UI |

## 8. Definition of done

- [ ] All Phase 1 endpoints in §4.4 implemented and covered by tests written per §4.5
- [ ] Backend exit criteria (§4.6) demonstrated against a real staging deploy, not just locally
- [ ] Frontend exit criteria (§5.5) demonstrated in a browser, not just component tests
- [ ] `code-review` run against this document as the spec, findings resolved or explicitly deferred
      with a reason
- [ ] Theme/design tokens from §5.1 committed so Phase 2+ reuse them rather than re-deciding visual
      direction per screen
- [ ] Every out-of-scope item in §2 is a visible "coming soon" state, not a broken link or missing nav
      item
