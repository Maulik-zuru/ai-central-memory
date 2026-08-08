# Phase 8 (Extension Slice) Implementation Plan — Browser Extension

**Source documents:** `Product_Requirements.md` §7.7 (`US-INT-01`, `US-INT-02`, partial `US-ADV-01`),
`US-MEM-02`, `US-MEM-03`, `US-ACC-07`), `Backend_Plan.md` Phase 8, `Frontend_Plan.md` Phase 8
**Relationship to the master phase docs:** `Backend_Plan.md`/`Frontend_Plan.md` Phase 8 ("Cross-AI
Integrations") bundles seven sub-systems — browser extension, MCP, Custom GPT, TypingMind plugin,
Open API docs, desktop sync agent, Agent Skills. This document scopes **only the browser
extension**, the same way `Phase5_Implementation_Plan.md` shipped ChatGPT + Claude parsers and
documented a gap for four platforms rather than guessing at all six. The remaining six Phase 8
sub-systems are named in §3 and §9 as an explicit, tracked follow-up — not silently dropped.

---

## 1. Objective

> From a supported AI's chat page, a user can Quick-Inject a bucket's memories in two clicks
> (Frontend Phase 8 exit criteria, narrowed to the extension). Saving a highlighted selection
> completes in under two seconds, with no silent rewriting of the saved text (`US-MEM-02` AC).

## 2. What already exists vs. what's net-new

This is the most important table in this document: three of Phase 8's four backend building
blocks for the extension **already ship**, from Phases 1–4. The extension is mostly a new client
against endpoints that work today, not a new backend system.

| Capability | Status |
|---|---|
| Unified Bearer auth (session JWT **or** `mp_`-prefixed API key, same code path) — `shared/authenticate.ts` | **Exists** (Phase 1) — the extension authenticates purely as an API-key client, identical to the `curl` example in the README |
| One-click save — `POST /api/memories/one-click` | **Exists** (Phase 2) — `US-MEM-02`'s "save in <2s, exact text, no rewriting" story is already implemented server-side; the gap is the content-script UI, not the endpoint |
| Automatic capture with confirmation — `POST /api/capture`, `GET /api/suggestions`, `POST /api/suggestions/:id/approve\|dismiss` | **Exists** (Phase 2) — `US-MEM-03`'s draft-then-confirm flow already round-trips end to end for the dashboard inbox; the extension needs to surface the *same* pending suggestion in-page |
| Smart Memory context assembly — `POST /api/context/preview` | **Exists** (Phase 4) — this endpoint **is** Quick Inject's backend (`US-INT-02`, `US-ADV-01`): it already returns exactly the memories, token counts, and savings figure the injected context would use. Nothing new to build server-side for the inject payload itself |
| Bucket list + RBAC — `GET /api/buckets`, `requireBucketRole`/`optionalBucketRole` | **Exists** (Phase 3) — the extension's bucket selector reuses this unchanged |
| Per-platform auto-capture consent — `User.autoCapture` (Json), `PATCH /api/account/auto-capture` | **Exists** (Phase 1, `US-ACC-07`) — the schema already anticipates a per-platform key (e.g. `{"chatgpt": false}`); the extension is literally what turns this from a dashboard-only toggle into a real per-site enforcement point |
| Smart Mode toggle — `PATCH /api/account/smart-memory` | **Exists** (Phase 4) |
| Per-identity rate limiting — `apiRateLimit` | **Exists** (Phase 1), keyed by `req.auth.userId`, works unchanged for API-key callers |
| `ApiKey.scopes` column | **Exists as a stored field** (Phase 1) but **nothing enforces it yet** — no route currently checks `req.auth.scopes`. This phase is the first to actually need scope enforcement, because an extension-issued key is the first key that must *not* be able to do everything a dashboard session can |
| CORS (`CORS_ORIGIN`, single origin) | **Exists** (Phase 0/1) but scoped to the dashboard's own origin only — **net-new problem**: content scripts run inside third-party pages (`chatgpt.com`, etc.), which must never be added to that allow-list (see §4) |
| Dashboard "notebook" design system (paper/ink/cobalt tokens, Georgia+system-sans, shadcn/ui) | **Exists** (Phase 1 redesign, `frontend/src/app/globals.css`) — **net-new problem**: porting it into a Manifest V3 popup and an injected content-script UI is a fresh rendering context (isolated cascade), not a reused stylesheet |
| Ask (Phase 7), Chat History Archive (Phase 5), Files (Phase 6) | **Do not exist in code yet** — only their planning docs exist. Any extension surface that would depend on them (an "Ask this bucket" inject mode, chat-history recall from the page) is explicitly deferred, and this plan's architecture is written so adding it later is additive (§9), not a rebuild |

## 3. In scope / out of scope

**In scope**
- Manifest V3 Chrome extension — Chrome first, per `Frontend_Plan.md` §3/§7 ("Chrome first,
  Safari/Firefox behind polyfills")
- **Pairing flow**: connect the extension to an existing dashboard account without ever making the
  user copy-paste a raw API key by hand
- **Popup UI**: recent-memories list + search, bucket selector, memory count badge, Smart Mode
  toggle, inline edit/delete, settings (per-platform auto-capture toggles, disconnect, replay
  onboarding)
- **Content-script UI** on supported AI chat pages: a Quick Inject button (toolbar + a smaller
  inline button near the chat composer), a "Save to Memory" affordance on text selection, an
  in-page capture-confirmation card
- **Onboarding walkthrough** on first install, replayable later from the popup (`US-INT-01`)
- **Per-site adapter pattern** for a documented launch subset — ChatGPT, Claude.ai, Gemini — the
  same "ship a few, document the gap" call `Phase5_Implementation_Plan.md` §4 made for chat-import
  parsers
- Backend: pairing endpoints, scope-enforcement middleware, the CORS/host-permissions design that
  keeps third-party AI sites out of the API's CORS allow-list
- Design-token port into an isolated (Shadow DOM) rendering context

**Explicitly out of scope this document** (each with where it's tracked)
- **MCP server, Custom GPT actions, TypingMind plugin, Open API public docs, desktop sync agent,
  Agent Skills, platform-compatibility-matrix page** — the other six items in `Backend_Plan.md`/
  `Frontend_Plan.md` Phase 8. Filed as a follow-up "Phase 8b" document once this slice ships, not
  silently folded in or dropped.
- **Ask-mode injection** ("inject from Files/Chat History/All") — needs Phase 7's `/api/ask` to
  exist first; §9 explains how Quick Inject's request shape already anticipates this
- **Safari/Firefox builds** — Chrome-first is the explicit `Frontend_Plan.md` §7 call; Safari's
  separate signing/notarization process is flagged there (§8) as its own budget item, not this
  document's
- **Real adapters for platforms beyond ChatGPT/Claude.ai/Gemini** — every other AI tool in the
  PRD's "20+" ambition is a documented gap (§4), the same treatment Phase 5 gave the four unparsed
  chat-import platforms
- **Mobile browser extension support** — mobile Chrome/Safari don't support extensions; mobile-web
  *dashboard* parity is Phase 12's job, unrelated to this document

## 4. Infrastructure additions

| Addition | Why | Plan |
|---|---|---|
| `extension/` package (Vite + `@crxjs/vite-plugin`, React 19, TypeScript, Tailwind v4) | Needs its own Manifest V3 build pipeline, distinct from `frontend/`'s Next.js one | A **third independent npm package**, sibling to `backend/`/`frontend/` — not a monorepo tool. The repo has never adopted workspaces even though `Frontend_Plan.md` Phase 0 once mentioned one; matching the codebase's actual shape (independent packages, no shared-package tooling) avoids introducing new build infrastructure this repo hasn't otherwise needed, at the cost of a small amount of duplicated Zod-schema/type definitions between `frontend/` and `extension/` — an acceptable trade given how few shapes are actually shared (memory, bucket, context-preview) |
| `ExtensionPairingCode` model + pairing endpoints | Asking a new user to open Settings → API Keys, create a key, and paste it into an extension popup is the wrong first-run experience for something meant to be usable in "≤2 clicks" (`Frontend_Plan.md` §4) | A short-lived code, generated by the extension, claimed by the logged-in dashboard with one explicit confirm click — the same "explicit, visible authorization step, no silent background enrollment" bar `US-INT-07`'s desktop-agent story already sets for a different integration; reused here for a consistent pairing UX across both (see §9) |
| `requireScope()` middleware (`shared/requireScope.ts`) | `ApiKey.scopes` has existed since Phase 1 but nothing reads it; an extension-issued key is the first key in the system that genuinely must be restricted — it should never be usable to manage billing, delete the account, or mint further API keys, even if a bug in the extension tried | Mirrors `requireBucketRole`'s shape exactly: reads `req.auth.scopes`, 403s `INSUFFICIENT_SCOPE` if a required scope is missing; a **no-op for session auth** (`req.auth.via === 'session'`) so dashboard behavior is untouched — scopes only ever constrain API keys |
| CORS / host-permissions split (no change to `CORS_ORIGIN`) | Content scripts execute inside the *host page's* origin (`https://chatgpt.com`, `https://claude.ai`, ...). Adding those origins to the API's CORS allow-list would mean any script on those third-party pages that can reach `fetch()` shares the API's CORS trust — an unacceptable widening for a security boundary the PRD explicitly cares about (`US-SEC-01`) | Content scripts **never** call the API directly. They `chrome.runtime.sendMessage` the background service worker, which holds `host_permissions` for the API's origin in `manifest.json`. Extension-context fetches from a page holding `host_permissions` are exempt from browser-enforced CORS entirely — this is the standard MV3 pattern, and it means `CORS_ORIGIN` stays exactly as narrow as it is today |
| `SiteAdapter` interface | Every AI chat UI has different DOM structure for "where is the composer" and "how do I read the last AI turn" | Same "the seam is the interface" precedent as `ConversationImportProvider` (Phase 5) and `DocumentParser` (Phase 6): `{ matches(url): boolean; getComposerEl(): HTMLElement \| null; getLastAssistantTurn(): string \| null; injectText(text: string): void }`. Ships with ChatGPT + Claude.ai + Gemini adapters; a fourth platform later is a new implementation file, not a rewrite of the content-script host |
| Shadow-DOM design-token bridge | Injected UI must not inherit the host page's CSS (ChatGPT's own styles leaking in) and must not leak the dashboard's CSS into the host page either | Mount into a **closed `ShadowRoot`** via `chrome.scripting`, re-declare `globals.css`'s CSS custom properties (`--background`, `--primary`, `--card`, etc.) inside the shadow root's own `:host` scope — same token *values*, an isolated cascade |

## 5. Backend plan

### 5.1 Schema additions

```prisma
model ExtensionPairingCode {
  id         String    @id @default(cuid())
  code       String    @unique          // short, typo-resistant (Crockford base32, 8 chars)
  userId     String?                    // set once claimed by a logged-in dashboard session
  user       User?     @relation(fields: [userId], references: [id], onDelete: Cascade)
  consumedAt DateTime?                  // set the moment the key is handed back — never twice
  expiresAt  DateTime                   // short TTL (10 minutes) — an abandoned pairing attempt
                                         // must not stay claimable indefinitely
  createdAt  DateTime  @default(now())

  @@index([code])
}
```

No change to `ApiKey`'s shape — an extension-paired key is just an `ApiKey` row created through
the **existing, unchanged** `apiKeyService.issue(userId, name, scopes)` (Phase 1's deep module:
callers never see `keyHash`, never see the raw key again after issuance — the pairing flow doesn't
get a special exception to that rule). `name` is set to `"Browser Extension — Chrome (<date>)"` so
it's recognizable and revocable from the existing Settings → API Keys screen without any new UI
there.

`EXTENSION_SCOPES = ['memory:write', 'memory:read', 'context:read', 'bucket:read', 'suggestion:read', 'suggestion:write', 'account:read']` —
deliberately excludes `apikey:manage`, `account:delete`, and any future billing scope.

### 5.2 Services

- **`extension-pairing.service.ts`**
  - `start()`: mints an `ExtensionPairingCode` (unauthenticated call — the extension has no user
    yet), 10-minute TTL. Rate-limited by IP (`pairingRateLimit`, mirroring `authRateLimit`'s
    shape), not by user, since there is no authenticated identity at this point.
  - `claim(userId, code)`: dashboard-side, **requires an active session** (never an API key — a
    key can't authorize minting another key). Validates the code is unexpired and unconsumed,
    calls `apiKeyService.issue(userId, name, EXTENSION_SCOPES)` unchanged, marks the code
    consumed, and returns the raw key **once**. This is the "explicit, visible authorization"
    click — the dashboard renders a plain "Connect this browser extension to your account?"
    confirmation before calling it, not an automatic claim on page load.
  - `status(code)`: the extension polls this after opening the dashboard's connect tab. Returns
    `pending` until claimed, `claimed` (with the key, exactly once — a second poll after delivery
    reports `expired` semantics so a leaked poll response can't be replayed), or `expired`.

- **`shared/requireScope.ts`** — `requireScope(scope: string)`: `asyncHandler` middleware,
  identical control-flow shape to `requireBucketRole`. Throws `AppError.forbidden(..., 'INSUFFICIENT_SCOPE')`
  when `req.auth.via === 'apiKey' && !req.auth.scopes.includes(scope)`; passes through unchanged
  for session auth and for any API key that does carry the scope.

### 5.3 Endpoints

| Method | Path | Auth | Maps to |
|---|---|---|---|
| POST | `/api/extension/pairing/start` | none (IP rate-limited) | new — mints a pairing code |
| POST | `/api/extension/pairing/claim` (`{ code }`) | session | new — issues the scoped `ApiKey` |
| GET | `/api/extension/pairing/status` (`?code=`) | none (short poll, IP rate-limited) | new — extension polls until claimed |

Reused **unchanged**, called by the extension via the background relay:

| Method | Path | Used for |
|---|---|---|
| POST | `/api/memories/one-click` | Inline "Save to Memory" |
| POST | `/api/capture` | Background auto-capture pass |
| GET | `/api/suggestions` / POST `/:id/approve` / `/:id/dismiss` | In-page capture-confirmation card |
| POST | `/api/context/preview` | Quick Inject's preview-then-inject payload |
| GET | `/api/buckets` | Bucket selector |
| GET | `/api/account/me`, PATCH `/auto-capture`, PATCH `/smart-memory` | Settings popup |
| DELETE | `/api/keys/:id` | "Disconnect extension" (revokes the paired key, reusing Phase 1's existing revoke path) |

`requireScope('apikey:manage')` is added to `apiKeyRouter`'s existing routes so an extension-scoped
key specifically **cannot** call `POST /api/keys` to mint further keys for itself, even though a
dashboard session still can exactly as today.

### 5.4 Testing (`tdd`) — acceptance criteria as red tests first

1. A pairing code can be claimed exactly once — a second `claim` on the same code fails, proving
   no replay (`US-ACC-03`'s "revoked/one-time keys fail immediately" spirit, applied to pairing).
2. An expired pairing code cannot be claimed even if otherwise well-formed.
3. `claim` called with an API-key `Authorization` header (not a session) is rejected — pairing must
   only ever be authorized by an interactive session, never by another key.
4. An extension-scoped key succeeds against `POST /api/memories/one-click` and `POST
   /api/context/preview` but gets `403 INSUFFICIENT_SCOPE` against `POST /api/keys` — the central
   test this phase exists to make pass.
5. A session-authenticated request to every route touched by `requireScope` behaves identically
   before and after this phase (regression guard on the Phase 1–4 suite).
6. `status` returns the key on the first poll after a claim and `expired` on every poll after
   that — proving the "exactly once" delivery contract, not just the "exactly once claim" contract.

### 5.5 Backend exit criteria

A freshly installed extension can pair with a logged-in dashboard account without the user ever
seeing or typing a raw API key, and the resulting key can call every endpoint the extension
actually needs but is rejected by scope-gated account-management endpoints.

---

## 6. Extension plan

### 6.1 Where this lives

New `extension/` directory at the repo root, sibling to `backend/` and `frontend/` (see §4).

### 6.2 Architecture (three contexts, working within Manifest V3's constraints)

`Frontend_Plan.md` §8 already flags MV3's non-persistent background scripts as a design risk for
this phase — addressed directly here rather than discovered mid-build:

- **Background service worker** — the only context with `host_permissions` for the API's origin.
  Owns the pairing poll, stores the API key (`chrome.storage.session` for the key material —
  cleared on browser restart, forcing a lightweight re-auth rather than key material persisting
  indefinitely in plain local storage; `chrome.storage.local` for non-secret prefs like the last
  selected bucket), and relays every API call from content scripts and the popup via
  `chrome.runtime.onMessage`. Written **stateless-per-message** from the start — MV3 can terminate
  and restart the worker between messages, so nothing is held in module-level memory across calls
  that isn't also durably in `chrome.storage`.
- **Content scripts** — one bundle, gated per-origin by `SiteAdapter.matches()`, rendered into a
  closed Shadow DOM on ChatGPT/Claude.ai/Gemini: the inline Quick Inject button near the composer,
  the "Save to Memory" selection affordance, the capture-confirmation card, a small memory-count
  badge.
- **Popup** (toolbar icon) — the fuller panel: recent memories + search, bucket selector, Smart
  Mode toggle, inline edit/delete, memory count, and a settings view (per-platform auto-capture
  toggles, disconnect, replay onboarding).

### 6.3 Screens & components

- **Onboarding walkthrough** — fires on `chrome.runtime.onInstalled`, a 3-step overlay: activate
  the extension, save something, Quick Inject. Replayable later from popup settings — satisfies
  `US-INT-01`'s AC directly (covers activation + save + inject, replayable).
- **Quick Inject** — click → calls `POST /api/context/preview` for the selected bucket (or every
  accessible bucket if none is picked) → renders the **exact** preview (memory count + token
  count + savings %, the same numbers the dashboard's `US-ADV-01` preview panel shows, because
  it's the same endpoint) → an explicit "Inject" confirm, not an inject-on-first-click. This
  satisfies `US-INT-02`'s "injected content matches what the context preview would show" AC by
  construction — there is no second implementation of the preview logic to drift from the first.
- **Inline save** — highlighting text on a supported page surfaces a small "Save to Memory"
  button near the selection → `POST /api/memories/one-click` with the selection's exact text (no
  LLM rewrite in the path, per `US-MEM-02`) → a toast confirmation, target under 2 seconds
  click-to-confirmation.
- **Capture-confirmation card** — when the background's periodic `/api/capture` call (triggered on
  conversation-turn boundaries the active `SiteAdapter` detects) returns a pending suggestion, a
  floating card renders in the same visual language as the dashboard's `CaptureCard`
  (`frontend/src/components/memory/suggestion-cards.tsx`) with Approve/Dismiss wired to the
  **same** `/api/suggestions/:id/approve|dismiss` endpoints — a suggestion actioned in the
  extension disappears from the dashboard inbox and vice versa, because it's one suggestion store
  with two renderers, not two suggestion systems.
- **Bucket selector** — `GET /api/buckets`, the same accessible-bucket list the dashboard's bucket
  nav already renders — one dropdown, not a redesigned picker.
- **Settings** — Smart Mode toggle, per-platform auto-capture toggles (reads/writes the exact same
  `User.autoCapture` map Settings → Privacy edits today, so the two surfaces can never disagree),
  "Disconnect extension" (`DELETE /api/keys/:id`), replay onboarding.

### 6.4 Design direction

Ran `ui-ux-pro-max --design-system` against `"browser extension AI memory assistant floating
panel productivity tool"` before writing this section. Its default color/typography
recommendation (a teal/orange palette, Inter) is **deliberately overridden**: the dashboard
already has a documented, intentional visual identity (`Phase1_Implementation_Plan.md`'s
"notebook" redesign — paper background `#faf9f5`, ink `#191b22`, a single cobalt accent `#2c4be0`,
a Georgia-esque display serif for headings, system-sans for body, mono for technical bits), and
`Frontend_Plan.md` §4's "one context model everywhere" principle means the extension must read as
the *same product* seen through a smaller window — not a second brand invented because it happens
to live in a different codebase. This is the same "no new accent colors introduced without reason"
discipline `Phase5_Implementation_Plan.md`/`Phase6_Implementation_Plan.md` §7 already applied to
their own new screens.

What **is** adopted from the tool's search results, because these are genuinely new decisions this
product hasn't had to make before (nothing prior lives in a content-script/popup context):

- **Micro-interactions style** (the tool's actual match for "productivity tool / floating panel"):
  hover feedback in 150–300ms, displacement kept under ~2px so it reads as feedback not motion,
  animating only `transform`/`opacity` — not incidental here, since a content script shares the
  host page's main thread and a layout-thrashing animation would visibly jank the host AI site.
- **Toast/confirmation guidelines**: save confirmations auto-dismiss in 3–5 seconds; Quick Inject
  requires an explicit confirm rather than injecting instantly (also load-bearing for the
  `US-INT-02` AC above); destructive actions (dismissing a duplicate/stale suggestion) keep a
  clear affordance rather than a silent success with no feedback.
- **Accessibility baseline**: 44×44px minimum hit targets even in the compact popup (some users
  run Chrome on touch laptops), visible focus rings never suppressed, `prefers-reduced-motion`
  respected inside the shadow root exactly like `globals.css` already does at the dashboard level,
  4.5:1 text contrast carried over from the existing palette (already verified there).
- **Icon discipline**: Lucide SVGs only, matching `frontend`'s existing `lucide-react` dependency
  — no emoji, so a Quick Inject affordance sitting in the corner of someone's ChatGPT tab reads as
  a serious tool's UI, not a browser toy.
- **Popup width**: ~360–400px, Chrome's practical popup ceiling. The Georgia display serif may not
  survive at this width for headings without feeling cramped — verified visually during build, not
  assumed from the dashboard's larger canvas.

### 6.5 Data fetching / state

- `useExtensionAuth()` — a Zustand store analogous to `frontend/src/lib/auth-store.ts`, holding
  pairing/connection state (not the raw key material itself, which stays in the background
  worker's `chrome.storage.session`).
- `useQuickInject({ bucketId })`, `useOneClickSave()`, `usePendingCapture()`, `useBuckets()`,
  `useAccount()` — thin wrappers over `chrome.runtime.sendMessage` calls into the background
  relay, deliberately shaped like `frontend/src/lib/api.ts`'s existing functions so the *logic*,
  not just the visual language, stays recognizable across dashboard and extension.

### 6.6 Extension exit criteria

From ChatGPT, Claude.ai, or Gemini's chat page: highlighting text and clicking "Save to Memory"
produces a memory visible in the dashboard within two seconds, with no altered text. Clicking
Quick Inject shows the same preview `POST /api/context/preview` would return in the dashboard and,
on confirm, inserts it into the page's composer without navigating away. A fresh browser profile
can pair the extension to an existing account end-to-end without the user ever seeing a raw API
key.

---

## 7. Skills used, mapped to this phase

Extends the running table (Phase 1 §3, Phase 2 §4, Phase 3 §5, Phase 4 §7, Phase 5 §7, Phase 6 §7)
— only what's new or specifically re-applied here:

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Discovery | `find-skills` | Searched the skills marketplace (`npx skills find "chrome extension"`, `"browser extension"`, `"manifest v3"`, `"web extension"`, `"extension"`) for a dedicated Chrome-extension-building skill — **none exists** as of this writing. Noted explicitly so a future contributor doesn't re-search and can instead extend this document if one appears later |
| New provider/adapter seam | `codebase-design` | `SiteAdapter` and `requireScope` are new interface boundaries in the same family as `ConversationImportProvider`/`DocumentParser` — getting the boundary right means a fourth AI platform or a future MCP/extension coexistence policy plugs in behind an unchanged host, not a rewrite |
| Pairing-code semantics | `domain-modeling` | "What makes a pairing code consumed, and can it ever be re-claimed" has to be answered precisely before `ExtensionPairingCode.consumedAt` is a schema column — the same discipline Phase 5 applied to conversation idempotency keys |
| Test-first | `tdd` | Pairing replay, TTL expiry, and scope enforcement are exactly the kind of code that looks right and is silently wrong under a retry or a missing check — written as red tests first |
| UI/UX design intelligence | `ui-ux-pro-max` | Explicitly queried for this document (§6.4) — its motion timing and accessibility/UX-guideline recommendations are adopted; its color/typography recommendation is deliberately overridden in favor of the existing house style, and that override is written down so it isn't "corrected" back by a future contributor unaware of the reasoning |
| Visual consistency & accessibility | `frontend-design`, `high-end-visual-design`, `web-design-guidelines` | The popup and content-script UI are new rendering *contexts* (Shadow DOM, MV3 popup) but must not become a new *design language* — these skills anchor that the notebook identity, not a generic extension look, carries over |
| Component reuse | `vercel-composition-patterns` | The capture-confirmation card and bucket selector are explicit ports of `suggestion-cards.tsx`/the dashboard's bucket selector, not parallel reimplementations |

## 8. Delivery order (suggested)

1. **Backend:** `ExtensionPairingCode` schema + migration; `extension-pairing.service`; pairing
   endpoints; tests first (§5.4 items 1–3, 6)
2. **Backend:** `requireScope` middleware, applied to `apiKeyRouter`; tests first (§5.4 items 4–5)
3. **Backend:** document the CORS/host-permissions boundary (§4) — no code change to `CORS_ORIGIN`
   itself, since content scripts never call the API directly
4. **Extension infra:** `extension/` package scaffold (Vite + CRXJS + React + TypeScript +
   Tailwind v4), `manifest.json` (MV3, `host_permissions` to the API origin only, `content_scripts`
   matches for the 3 launch platforms), background service-worker skeleton + storage
5. **Extension:** pairing UI (popup "Connect" screen) end-to-end against the new backend endpoints
6. **Extension:** popup panel (memory list/search, bucket selector, Smart Mode toggle, settings)
   wired to the reused Phase 1–4 endpoints
7. **Extension:** `SiteAdapter` interface + ChatGPT/Claude.ai/Gemini implementations
8. **Extension:** content-script UI (Quick Inject, inline save, capture-confirmation card) inside
   the Shadow DOM, with ported design tokens (§6.4)
9. **Extension:** onboarding walkthrough + replay
10. **Both:** `code-review` and `web-design-guidelines` pass; manually verify the exit criteria
    (§6.6) live on all three launch platforms, not a synthetic test page only
11. **Packaging:** Chrome Web Store listing (icons, store copy, privacy disclosure — the store
    listing's data-use section must state the same no-training/no-sale commitment as `US-SEC-02`,
    not just the app's own privacy page)

## 9. Alignment with future work

- **Ask-mode-ready, not Ask-mode-built:** Quick Inject's request shape (`{ bucketId?, tokenBudget? }`)
  is identical to `context/preview`'s today. Once Phase 7 ships `/api/ask`, adding an "Ask this
  bucket" mode to Quick Inject is a new button calling a new endpoint — not a rearchitecture of the
  injection pipeline built here.
- **Pairing pattern is reusable, not a one-off:** `ExtensionPairingCode`'s shape (short-lived code
  + explicit dashboard-side confirm click) is the same primitive `US-INT-07`'s desktop sync agent
  will need for its own "explicit, visible authorization" requirement. The future desktop-agent
  doc should reuse this pairing primitive rather than inventing a second one.
- **Scope enforcement is a platform capability, not an extension-only feature:** `requireScope` is
  introduced by this phase but written generically so Custom GPT actions and the TypingMind plugin
  (both future Phase 8 sub-systems) can each be issued their own minimally-scoped key through the
  same mechanism, rather than each growing its own ad hoc restriction logic.
- **`SiteAdapter` and MCP coexistence** — a user may eventually have both the extension and an MCP
  connection active against the same AI tool (e.g. Claude Code). Resolving whether/how those should
  coordinate is explicitly out of scope here and flagged for the future MCP-focused Phase 8
  document, not decided by default in this one.

## 10. Traceability checklist

| Requirement | Covered by |
|---|---|
| Browser extension install and onboarding (`US-INT-01`) | §6.3 onboarding walkthrough |
| Quick Inject (`US-INT-02`) | §5.3 reused `context/preview`, §6.3 Quick Inject button |
| One-click save (`US-MEM-02`) | §5.3 reused one-click endpoint, §6.3 inline save |
| Automatic capture with confirmation (`US-MEM-03`) | §5.3 reused capture/suggestions endpoints, §6.3 capture-confirmation card |
| Per-platform auto-capture consent (`US-ACC-07`) | §5.3 reused `account/auto-capture`, §6.3 settings |
| Context preview / token savings, extension surface (`US-ADV-01`) | §6.3 Quick Inject preview-before-inject |
| API key safety extended to pairing (`US-ACC-03`) | §4/§5 `ExtensionPairingCode` + `requireScope` |

## 11. Definition of done

- [ ] Pairing endpoints implemented and covered by tests per §5.4; Phase 1–4's existing test suite
      still passes unmodified
- [ ] Extension installs unpacked in Chrome and pairs to a real dev account with no manual key entry
- [ ] Extension exit criteria (§6.6) demonstrated live on ChatGPT, Claude.ai, and Gemini — not a
      synthetic fixture page
- [ ] `code-review` and `web-design-guidelines` run against this document and the PRD as spec
- [ ] §6.4's design-direction overrides are written into the extension's own README so a future
      contributor doesn't "fix" the palette back toward the generic tool recommendation
- [ ] The remaining six Phase 8 sub-systems (§3) are filed as an explicit "Phase 8b" follow-up
      document, not silently left unscoped
- [ ] Safari/Firefox builds and platforms beyond the 3 launch adapters are filed as explicit
      fast-follows (§3), each with the current gap stated in the extension's own store listing/UI
      copy, not discovered by a confused user
