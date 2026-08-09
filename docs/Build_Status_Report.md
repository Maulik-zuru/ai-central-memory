# Build Status Report — AI Memory & Context Platform

**Date:** 2026-08-09
**Branch:** `claude/desktop-agent`
**Scope:** Phases 1–13 (`Backend_Plan.md` / `Frontend_Plan.md` / `Phase13_DesktopAgent_Implementation_Plan.md`)

---

## 1. Executive summary

Phases 1–13 are implemented and the automated suite is green: **160 backend tests across 22
suites**, plus **30 desktop-agent unit tests**. Frontend, browser extension, and desktop app all
typecheck and build.

That headline is narrower than it sounds, and this report exists to say where. Three things
qualify it:

1. **Phase 8 shipped one of its seven sub-systems.** The browser extension exists; MCP, Custom GPT
   actions, the TypingMind plugin, the public API, the desktop sync agent, and Agent Skills do not.
   Phase 8's own exit criterion is unachievable as written.
2. **The load-test budgets have never been measured.** The k6 scripts are written and the numbers
   are documented, but k6 is not installed and the scripts have never run. Phase 12's exit
   criterion is genuinely unmet.
3. **Every external integration runs against a stub by default.** LLM, embeddings, email, storage,
   and payments all fall back to deterministic stubs. Retrieval quality is therefore calibrated
   against a hash-based embedding with no semantic understanding.

Nothing in this report is inferred from code compiling. "Verified" below means the thing was
executed — against live servers, a real browser, or a real database — and observed to behave
correctly.

---

## 2. What "verified" means in this report

| Term | Meaning |
|---|---|
| **Verified** | Executed end-to-end and observed working: live HTTP calls, a real browser session, or a real database. |
| **Covered by tests** | Asserted by the automated suite, which runs against a real Postgres with pgvector — not mocks. |
| **Built, unexercised** | The code exists and typechecks, but the path it targets has never been run. |
| **Not built** | Named in a plan document; no implementation exists. |

---

## 3. Working — verified by execution

### 3.1 Core product

| Capability | Phase | Status | Evidence |
|---|---|---|---|
| Registration, login, sessions, API keys | 1 | Verified | Suite + live E2E |
| Memory capture → suggestion → approve | 2 | Verified | Suite + browser |
| Duplicate / stale detection | 2 | Covered by tests | Distance thresholds asserted |
| Buckets, hierarchy, sharing, RBAC | 3 | Verified | Suite + browser; role-exclusivity asserted |
| Smart Memory retrieval + categorization | 4 | Verified | Token-budget accounting checked against real numbers |
| Chat history import + resumable sync | 5 | Verified | ChatGPT/Claude exports imported live |
| Files: PDF, DOCX, Markdown, plain text | 6 | Verified | Upload → parse → chunk → embed → cite |
| Ask across memories/history/files | 7 | Verified | Multi-source answers with citations |

### 3.2 Phases 9–12

| Capability | Status | Evidence |
|---|---|---|
| Knowledge graph extraction + explorer | Verified | Live: "Project Aurora" ↔ "Client Nova" linked, click-through to source memory worked |
| Usage analytics rollup | Verified | Events recorded at four real action sites; rollup matched hand-computed expectation |
| Billing: upgrade/downgrade via webhook | Verified (stub provider) | Plan change took effect on the very next request |
| Idempotent webhook handling | Covered by tests | Same event twice applies once; failures return non-2xx so Stripe retries |
| Pro-gate retrofit across Phases 3/4/5/9 | Covered by tests | Every previously-open Pro feature now gated |
| Data export (async, tracked, expiring) | Verified | Requested, polled, downloaded from the UI alone |
| Permanent account deletion | Verified | Typed confirmation → rows gone, storage objects gone, re-login refused |
| Compliance evidence survives deletion | Covered by tests | `ComplianceLog` readable with zero matching `User` rows |
| Auto-capture consent enforcement | Verified | Extension's own key: `chatgpt` off → 0 suggestions, `claude` on → 1 |
| Backup and restore | Verified | Real drill: 32 tests passed **against the restored database** |
| HNSW vector indexes | Verified | 38.5 ms → 1.3 ms at 5,000 rows; guarded by a regression test |
| WCAG 2.1 AA accessibility | Verified | axe-core sweep over 16 routes: 16 violations → 0 |
| Ops health endpoint | Covered by tests | 404 when unconfigured; rejects user sessions and customer API keys |

### 3.3 Browser extension

Verified by loading the built extension into a real Chromium instance and driving the UI:

- MV3 manifest loads; background service worker registers
- Popup renders the unpaired state
- Connect opens the dashboard at the correct origin with a pairing code
- Consent banner discloses scopes before granting
- Confirming stores the key in `chrome.storage.session`
- Popup transitions to the connected panel
- Content script mounts on a matching page into a **closed** shadow root
- Quick Inject affordance renders
- Extension-scoped key is refused (403) by `DELETE /api/account` and `POST /api/account/export`

### 3.4 Desktop agent (Phase 13)

Verified by running the pipeline end-to-end against a live backend on this machine: pair a device,
drop a fixture Claude Code transcript into a watched folder, and watch it become pending
suggestions on the account.

- `POST /api/desktop/pairing/start` → code, dashboard-session `claim` → device row + scoped key
- Key delivered on the first status poll only; a second poll reports `expired`
- A real Claude Code JSONL transcript parsed into 2 snippets; a planted `sk-` key was stripped by
  `redact()` before anything was queued
- Queue drained by the uploader → **2 pending capture suggestions** visible on the account
- Platform consent toggled off → the next capture returned `201` with **0 suggestions**
- Device revoked from the dashboard → the agent's very next capture returned **401**
- Electron app boots headlessly under `xvfb`; the renderer sees exactly the preload bridge and
  `window.require` / `window.process` / `window.module` are all `undefined`

---

## 4. Built but never exercised — the testing backlog

This is the section that matters most. None of the following should be assumed working.

### 4.1 Load-test budgets are unmeasured — **Phase 12 exit criterion unmet**

`backend/loadtest/ask.js` and `context-preview.js` are written, with documented budgets
(p95 < 3000 ms and < 500 ms respectively). **k6 is not installed in this environment and neither
script has ever executed.** The budgets are targets someone chose, not evidence.

> `Backend_Plan.md` Phase 12 requires "documented load-test results within target latency/error
> budgets." That criterion is **not met**.

**To close:** install k6, seed a realistically-sized account, run both scripts against a
staging-like environment, record the results.

### 4.2 Extension site adapters vs. live products — **highest residual risk**

Every DOM selector in `extension/src/lib/site-adapters/{chatgpt,claude,gemini}.ts` is unverified
against the real products. No authenticated credentials exist in this environment, so verification
used a mock page matching the manifest's URL pattern.

This proves the extension's own machinery — manifest, service worker, messaging, pairing,
shadow-DOM mount, consent gate — but **not** that the selectors match today's markup. ChatGPT,
Claude, and Gemini ship DOM changes without notice.

**Consequence if wrong:** the extension installs, pairs, and appears healthy while silently
capturing nothing and injecting nowhere.

**To close:** manually exercise capture, Quick Inject, and one-click save on each of the three
products with a real signed-in account.

### 4.3 Stripe has never made a network call

All billing verification used the stub `PaymentProvider`. The real Stripe client — hosted checkout
session creation, billing portal sessions, and HMAC-SHA256 webhook signature verification — has
never contacted Stripe.

> `Phase10_Implementation_Plan.md` §11 requires the exit criteria be "demonstrated with real Stripe
> test-mode webhooks." That has **not** happened.

**To close:** configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`; run
checkout → webhook → upgrade → cancel → downgrade against test mode.

### 4.4 Every provider defaults to a stub

| Provider | Stub behaviour when unconfigured |
|---|---|
| `LlmProvider` (extraction, summarize, rerank, answer, entities) | Deterministic heuristics — sentence splitting, keyword overlap, capitalized-word entity guessing |
| Embeddings | **Feature-hashing with no semantic understanding** |
| `EmailProvider` | In-memory outbox; no mail is sent |
| `StorageProvider` | Local disk; no S3 implementation exists |
| `PaymentProvider` | Fake session URLs; unsigned webhooks accepted |

The embedding stub matters most. Duplicate detection, stale detection, category matching, Ask
relevance, and the knowledge graph are **all calibrated against it**. Every threshold in the
codebase is documented as a "first calibrated guess" and will need re-tuning against a real
embedding model.

### 4.5 Lighthouse CI budgets — planned, not built

`Phase12_Implementation_Plan.md` §4 specifies `@lhci/cli` with a budget config gating CI. **Only
the axe-core accessibility sweep was built.** No Lighthouse dependency or config exists.

I previously marked the Phase 12 frontend task complete without it. That was an overstatement;
it is corrected here.

### 4.6 CI pipeline has never triggered

`.github/workflows/ci.yml` is committed with five jobs (backend, frontend, extension,
accessibility, desktop) but no push has yet run it. Expect first-run corrections around service-container
readiness, Playwright browser installation, and cache paths.

### 4.7 Desktop installers are unsigned, and two of three sources are stubs

Three separate gaps, all in Phase 13 and all stated in that plan's §9 before implementation began:

1. **No signed `.dmg` or `.exe` exists.** Notarization needs macOS plus an Apple Developer
   identity; Authenticode needs a Windows certificate. `electron-builder.yml` and a
   `macos-latest`/`windows-latest` release matrix are written and **have never run**. Until they
   do, there is no artifact a user can install.
2. **The app has never run on macOS or Windows.** It was built and smoke-launched on Linux under
   `xvfb`. Tray behaviour, `safeStorage` (Keychain / DPAPI), the folder picker, and window chrome
   are all unverified on the two platforms this phase targets.
3. **Cursor and Codex sources are visible stubs.** No sample of either format was available, so
   both ship disabled with the reason shown in the Sources screen. Only `claude-code` captures
   anything today.

Auto-update is wired behind `DESKTOP_UPDATE_FEED_URL` and is off; it cannot be tested without
signed builds.

---

## 5. Not built

### 5.1 Phase 8 shipped one of seven sub-systems

`Backend_Plan.md` Phase 8 ("Cross-AI Integrations") bundles seven sub-systems. Two exist — the
browser extension (Phase 8) and the desktop agent (Phase 13).

| Sub-system | Story | Status |
|---|---|---|
| Browser extension | `US-INT-01`, `US-INT-02` | **Built** |
| MCP server (hosted + local), `McpToken` auth | `US-INT-03` | Not built |
| Custom GPT actions / OpenAPI subset | `US-INT-04` | Not built |
| TypingMind plugin backend | `US-INT-05` | Not built |
| Public/open API, versioned OpenAPI spec | `US-INT-06` | Not built |
| Desktop sync agent (macOS + Windows), `DesktopAgentDevice` | `US-INT-07` | **Built** (Phase 13) — installers unsigned, see §4.7 |
| Agent Skills packages | `US-INT-08` | Not built |
| `Platform` registry table | — | Not built |

Phase 8's exit criterion reads:

> "The same bucket's context can be pulled via the extension, via MCP from Cursor, and via the
> public API, and all three return consistent results."

**Two of those three paths do not exist**, so this criterion cannot currently be met. The desktop
agent narrows the gap but does not close it: it is a fourth *capture* client, not an MCP or public
API surface.

This was a deliberate, documented decision — `Phase8_BrowserExtension_Implementation_Plan.md`
states in its opening that it scopes only the browser extension and names the other six as tracked
follow-ups. The risk is not that it was hidden; it is that a phase-level roadmap showing "Phase 8
complete" implies far more than was delivered.

### 5.2 Chat import covers 2 of 6 platforms

ChatGPT and Claude parsers only. Gemini, TypingMind, Grok, and DeepSeek are a documented gap —
no verified export format was available to build against, so nothing was guessed and shipped as if
it worked (`chat-import.provider.ts:133`).

### 5.3 "No training on user data" — legal review outstanding

The engineering half is complete: zero-retention headers on every Anthropic call, and usage
analytics verified to carry only counts and token deltas, never content.

The customer-facing claim still requires compliance review of the provider's actual current terms.
`Product_Requirements.md` §10 flags this, and it is **a hard gate on general availability**. It is
not an engineering task and has not started.

---

## 6. Defects found and fixed during verification

Recorded because each was caught by *running* something, not by reading it.

### Security review findings (all fixed, all with regression tests)

| Severity | Finding | Fix |
|---|---|---|
| High | Export archives were written into the directory `express.static` serves **unauthenticated**, making the download endpoint's ownership and expiry checks unenforceable | Private storage namespace, never served statically |
| High | Export archives were never deleted and were not collected during account deletion — a full account dump survived "delete my account" forever, unreferenced | Reaper job on expiry + archives collected in the deletion sweep |
| High | Any API key, including a narrowly-scoped extension key, could export **and permanently delete** the entire account | Scope gate on export; deletion now requires a session, not any key |
| Medium | Access tokens survived "sign out all other devices" for up to 15 minutes, defeating the feature's purpose | `authenticate()` now rejects tokens whose session was revoked |
| Low | `ComplianceLog` recorded deletion as `completed` *before* the deletion ran | Written after success; failures recorded as `failed` |
| Low | Expiry check was fail-open on a null `expiresAt` | Fails closed |
| Low | Partial storage-deletion failure claimed "nothing was deleted" while objects were already gone | `allSettled`, accurate messaging, leftover keys logged for reconciliation |

### Extension defects (found by loading it in a browser)

- **No build could target a local backend.** `import.meta.env.DEV` is false for every `vite build`,
  so every loadable artifact hardcoded the production origin — the extension was untestable
  end-to-end. Fixed with explicit env vars and a `build:local` script.
- **Pairing opened the wrong origin in production.** The dashboard URL was derived by
  string-replacing `localhost` — a no-op in a production build, so Connect would have opened the
  API origin. Broken for every real user while working perfectly in dev.
- **The Phase 12 onboarding tour covered the pairing consent banner**, blocking the button a new
  user came to click.

### Regressions caught in my own work

- **`prisma migrate dev` silently dropped all four HNSW indexes.** Raw-SQL indexes on
  `Unsupported()` columns read as schema drift, so Prisma emitted `DROP INDEX` in the next
  generated migration — a one-line migration adding a boolean. Nothing failed; queries just
  reverted to sequential scans. Caught in review by a teammate's commit. Now restored, with
  `tests/vector-index.test.ts` asserting all four exist with the correct access method and operator
  class.
- **The auth rate limiter was firing mid-suite**, causing failures that surfaced as confusing
  downstream errors. Bypassed under test — and because bypassing a security control without
  coverage is its own problem, `tests/rate-limit.test.ts` was added to prove the limiters actually
  reject.

---

## 7. Test coverage

**160 backend tests across 22 suites**, run against a real Postgres with pgvector (no database
mocking), plus **30 desktop-agent unit tests** on the pure pipeline modules.

```
backend:  apikey  ask  auth  billing  bucket  capture  chat-history  compliance
          desktop  duplicate-stale  extension  file  image-memory  intelligence
          memory  ops  payments-flag  privacy  rate-limit  session  smart-memory
          vector-index

desktop:  redact  queue  claude-code.source  uploader
```

**Not covered by automated tests:**

- Frontend component/unit tests — none exist. Frontend verification has been manual browser
  driving plus `next build` and the axe-core sweep.
- Extension unit tests — none exist. Verification was manual, in a real browser.
- Desktop renderer/UI tests — none exist. The four screens have never been seen by a human on
  macOS or Windows; only the headless smoke launch and the pipeline unit tests have run.
- Load and soak testing — scripts exist, never run.
- Real-provider integration (Anthropic, OpenAI, Stripe, Resend) — stubs only.

---

## 8. Recommended next actions

Ordered by risk retired per unit of effort, not by phase number.

1. **Verify the three site adapters against live, authenticated sessions.**
   Highest residual risk. The extension is the flagship integration and may silently find nothing
   on a real page. Requires real accounts; roughly half a day.

2. **Push once and fix whatever CI surfaces.**
   The workflow has never executed. Until it does, "the suite is green" depends on someone
   remembering to run it locally.

3. **Install k6 and run the load tests.**
   Converts two documented budgets into measured evidence and closes a Phase 12 exit criterion
   that is currently unmet.

4. **Configure Stripe test-mode keys and replay the full billing flow.**
   Signature verification and checkout have never made a network call — the riskiest code to first
   exercise in production.

5. **Decide Phase 8's remaining six sub-systems: schedule them or formally descope them.**
   Either is defensible. What is not defensible is a roadmap reading "Phase 8 complete" while MCP
   and the public API do not exist.

6. **Configure real LLM and embedding providers, then re-tune every threshold.**
   Duplicate detection, categorization, Ask relevance, and graph extraction are all calibrated
   against a stub with no semantic understanding.

7. **Start the compliance review of the provider's data-use terms.**
   Long lead time, blocks GA, and is not engineering work — worth starting before the engineering
   is finished.

---

## 9. Known operational traps

Documented in full in `docs/Operations_Runbook.md`; summarised here because each has already
caused a real problem.

- **Never commit a generated migration without reading it.** `prisma migrate dev` emits
  `DROP INDEX` for the HNSW vector indexes because Prisma cannot describe them. Delete those lines.
  `tests/vector-index.test.ts` will fail if they slip through.
- **Use `npm run build:local` for the extension in development.** The default `build` targets
  production origins and cannot talk to a local backend at all.
- **Export archives are account dumps.** They live in `backend/private-storage/` (gitignored) and
  must never be served statically or committed.
- **A restore needs the object store too.** The Postgres dump contains `storageKey` references,
  not file bytes.

---

## 10. Document control

| Field | Value |
|---|---|
| Report version | 1.1 |
| Verification date | 2026-08-09 |
| Test result at time of writing | backend 160 passed / 160 total (22 suites); desktop 30 passed / 30 total |
| Superseded on requirements coverage by | `Requirements_Conformance_Report.md` (2026-08-09) — a story-by-story audit that found four gaps this report did not, including the unbuilt US-INT-01 walkthrough |
| Related | `Operations_Runbook.md`, `Phase11_Implementation_Plan.md`, `Phase12_Implementation_Plan.md`, `Phase13_DesktopAgent_Implementation_Plan.md`, `Payments_Feature_Flag.md`, `Product_Requirements.md` |
