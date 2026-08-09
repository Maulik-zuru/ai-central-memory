# Phase 13 Implementation Plan — Desktop Agent (macOS + Windows)

**Source documents**

- `docs/Product_Requirements.md` — **US-INT-07** (desktop sync agent, *Could* · Tier: Core),
  **US-MEM-03** (nothing is saved without review), **US-ACC-07** (per-platform auto-capture
  consent), **US-ACC-03** (API keys are shown once), **US-SEC-02** (no training, no sale)
- `docs/Backend_Plan.md` §Phase 8 — *"local agent (macOS) watches Claude Code/Codex/Cursor session
  data and pushes new context up via an authenticated device channel (`DesktopAgentDevice`)"*
- `docs/Phase8_BrowserExtension_Implementation_Plan.md` — the pairing flow, scope-restricted keys,
  and "a second client, not a second product" posture this phase deliberately mirrors
- `docs/Phase11_Implementation_Plan.md` — `platform` on `/api/capture`, the consent chokepoint this
  phase reuses rather than duplicates
- `docs/Payments_Feature_Flag.md` — `shared/entitlements.ts` is the only place plan questions get
  asked; the desktop agent asks none of its own

---

## 1. Objective

Ship a lightweight desktop agent for macOS and Windows that watches **explicitly opted-in local
AI-coding-session data** (Claude Code, Cursor, Codex) and feeds it into the same memory pipeline the
browser extension already uses — so terminal and editor work lands in the same notebook as browser
AI tools.

The success condition for this phase is narrow and worth stating plainly: **the desktop agent must
introduce no new capture semantics.** It is a third client of `/api/capture`, behind the same
per-platform consent gate, producing the same review-first `MemorySuggestion` rows. If a reviewer
can find a code path where a desktop-sourced snippet becomes a `Memory` without passing the
suggestion inbox, this phase has failed regardless of how polished the app looks.

---

## 2. What already exists vs. what's net-new

| Capability | State today | This phase |
|---|---|---|
| Review-first capture (`POST /api/capture` → `MemorySuggestion`) | Built (Phase 2), consent-gated (Phase 11) | **Reused unchanged.** New `platform` values only |
| Per-platform consent (`User.autoCapture`) | Built (Phase 11) | **Reused.** Three new platform keys surfaced in Settings → Privacy |
| Scope-restricted API keys (`requireScope`) | Built (Phase 8) | **Reused.** New `DESKTOP_AGENT_SCOPES` constant |
| Crockford pairing codes + one-shot key delivery | Built for the extension (Phase 8) | **Generalized** to a shared device-pairing service; extension behaviour unchanged |
| Device registry / revocation | Does not exist | **Net-new** `DesktopAgentDevice` model, list + revoke endpoints, Settings → Devices tab |
| Desktop application | Does not exist | **Net-new** `desktop/` Electron package |
| Local session-file parsing | Does not exist | **Net-new** `SessionSource` adapter interface + Claude Code implementation |
| Packaging / code signing | Does not exist | **Net-new** `electron-builder` config + CI matrix (see §9 for the honest limit) |

---

## 3. In scope / out of scope

### In scope

1. `desktop/` — an Electron + TypeScript + React 19 + Tailwind v4 application, sharing the notebook
   design language with the dashboard and extension.
2. Explicit, visible pairing (US-INT-07 AC: *"no silent background enrollment"*) reusing the
   extension's code → dashboard-confirm → one-shot-key flow.
3. A `SessionSource` adapter interface, with a **Claude Code** implementation (JSONL transcripts).
   Cursor and Codex adapters are **stubbed with a documented format gap** — see §9.
4. A redaction pass over every candidate snippet *before it leaves the machine*.
5. A local, bounded, crash-safe outbound queue so a laptop that sleeps or goes offline does not lose
   or duplicate captures.
6. Device registry: list paired devices in the dashboard, revoke one, and have revocation actually
   stop the agent (the underlying `ApiKey` is revoked, so the next request 401s).
7. Menu-bar / system-tray presence with a hard **Pause capture** control that is one click away.
8. `electron-builder` packaging config for `dmg` (arm64 + x64) and `nsis` (x64 + arm64), plus a
   GitHub Actions release matrix.

### Out of scope (and why)

- **Global keyboard, clipboard, screen, or accessibility-API monitoring.** The PRD says *"captures
  useful context from my coding sessions"*, not "from the machine". Watching opted-in files is the
  whole mandate; anything broader would be a privacy posture this product has consistently refused
  (US-ACC-07, US-SEC-02). This is a deliberate product boundary, not a scheduling deferral.
- **A full memory browser / editor in the desktop app.** The dashboard is the notebook. The agent
  shows *what it captured and what it queued*; deep browsing opens the dashboard in the browser.
- **Linux packaging.** Buildable (`AppImage` falls out of the same config) but untested and
  unclaimed; the PRD names macOS and Windows.
- **MCP server hosting inside the app** (US-INT-08 territory) — adjacent, still unbuilt, and it
  wants its own phase.
- **Auto-update rollout.** `electron-updater` is wired but **disabled by default** behind
  `DESKTOP_UPDATE_FEED_URL`; turning it on requires a signing identity this repo does not hold.

---

## 4. Framework decision: Electron, not Tauri

Tauri produces dramatically smaller binaries (~5 MB vs ~90 MB) and lower idle memory. It was the
serious alternative and it loses here for one reason: **it requires Rust**, and this repository is
end-to-end TypeScript — backend, frontend, extension, tests, scripts. Introducing a second
toolchain for a *Could*-tier feature would mean every future contributor touching the desktop app
needs a Rust environment, and none of the existing design tokens, `api.ts` client shapes, or React
components port for free.

Electron lets the desktop renderer reuse React 19, Tailwind v4, the notebook tokens, and the same
component idioms already reviewed twice. The cost is bundle size and RAM, and that cost is real —
it is written down here so nobody re-litigates it as an oversight.

This is the same call as SVG-over-WebGL for the knowledge graph (Phase 9) and in-process
`JobRunner`-over-BullMQ (Phase 6): take the boring, consistent option, and record what it costs.

---

## 5. Infrastructure additions

| Addition | Why |
|---|---|
| `desktop/` workspace package | New client, sibling to `extension/`. Independent `package.json`, never imported by backend or frontend |
| `electron`, `electron-builder`, `electron-vite` (dev deps) | App shell, packaging, and the Vite integration that gives main/preload/renderer a single build |
| `chokidar` | File watching with the debounce/atomic-write semantics `fs.watch` does not reliably give across macOS and Windows |
| `DESKTOP_UPDATE_FEED_URL` (env, optional) | Auto-update feed. Unset ⇒ update checks are skipped entirely |
| `VITE_API_BASE_URL` / `VITE_DASHBOARD_URL` (desktop build) | Same two-variable pattern the extension now uses — one build cannot infer both origins, a lesson already paid for in Phase 8 |

No new backend infrastructure. No new queue, no new storage bucket, no new provider.

---

## 6. Backend plan

### 6.1 Schema additions

```prisma
// Renamed from ExtensionPairingCode — the same table now serves the browser extension and the
// desktop agent. @@map keeps the physical table name, so this is a column add, not a data move.
model DevicePairingCode {
  id           String    @id @default(cuid())
  code         String    @unique
  client       String    @default("extension") // "extension" | "desktop"
  userId       String?
  user         User?     @relation(fields: [userId], references: [id], onDelete: Cascade)
  consumedAt   DateTime?
  deliveredKey String?
  deliveredAt  DateTime?
  expiresAt    DateTime
  createdAt    DateTime  @default(now())

  @@index([code])
  @@map("ExtensionPairingCode")
}

// The device channel Backend_Plan.md §Phase 8 called for. One row per paired machine.
model DesktopAgentDevice {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name       String    // user-visible, e.g. "Maulik's MacBook Pro"
  platform   String    // "darwin" | "win32"
  osVersion  String?
  appVersion String?
  // The scoped key this device authenticates with. Revoking the device revokes this key; the
  // relation is nullable so a key revoked directly from Settings → API Keys does not orphan the
  // device row (it shows as revoked instead of disappearing).
  apiKeyId   String?   @unique
  lastSeenAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}
```

`User` gains `desktopDevices DesktopAgentDevice[]`.

Migration: `20260809xxxxxx_desktop_agent`. **Add `IF NOT EXISTS` guards and re-verify the four HNSW
vector indexes survive** — `prisma migrate dev` silently dropped them once already
(`docs/Operations_Runbook.md` §vector-index trap); `tests/vector-index.test.ts` is the regression
guard and must stay green after this migration.

### 6.2 Services

- **`shared/device-pairing.service.ts`** (new, extracted): the Phase 8 pairing logic parameterized
  by a small config — `{ client, scopes, keyName(device) }`. Code generation, TTL, one-shot
  delivery, and replay protection are written once. `extension-pairing.service.ts` becomes a thin
  binding over it and keeps its exported `EXTENSION_SCOPES` so nothing downstream changes.
- **`modules/desktop/desktop.service.ts`** (new): `claim()` (issues the key *and* creates the
  `DesktopAgentDevice` in one transaction), `list()`, `revoke()` (revokes device + key together),
  `heartbeat()` (stamps `lastSeenAt`, `appVersion`, `osVersion`).

```ts
// Same exclusions as the extension, for the same reason: a device-issued key must never mint
// further keys, touch billing, or delete the account.
export const DESKTOP_AGENT_SCOPES = [
  'memory:write', 'memory:read', 'context:read',
  'bucket:read', 'suggestion:read', 'suggestion:write', 'account:read',
];
```

**No capture service changes.** The agent posts to `/api/capture` with
`platform: 'claude-code' | 'cursor' | 'codex'`, and `autoCaptureAllowed()` gates it exactly as it
gates `chatgpt`/`claude`/`gemini` today. That is the entire integration, and it is the point.

### 6.3 Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/desktop/pairing/start` | none, IP rate-limited | Mirrors the extension route exactly (`pairingRateLimit`) |
| `GET` | `/api/desktop/pairing/status` | none, IP rate-limited | One-shot key delivery |
| `POST` | `/api/desktop/pairing/claim` | **session only** | The visible authorization step. Body carries `{ code, deviceName, platform, osVersion, appVersion }` |
| `GET` | `/api/desktop/devices` | session or key | Device list for Settings → Devices |
| `DELETE` | `/api/desktop/devices/:id` | **session only** | Irreversible-ish; follows the `requireSessionAuth()` precedent set for account deletion in Phase 11 |
| `POST` | `/api/desktop/heartbeat` | API key | Agent-authenticated; resolves the device from `apiKeyId` |

### 6.4 Testing (`tdd`) — acceptance criteria as red tests first

1. `claim` with a valid code creates exactly one `DesktopAgentDevice` **and** one `ApiKey` whose
   scopes equal `DESKTOP_AGENT_SCOPES` — and that scope list does **not** contain `apikey:manage`.
2. `status` returns the key once; a second poll returns `expired` and no key.
3. An expired code (TTL elapsed) cannot be claimed.
4. A pairing code minted for `client: 'desktop'` cannot be claimed through the extension endpoint,
   and vice versa — the generalization must not create a cross-client confusion path.
5. `claim` requires a session; presenting a valid API key instead returns 401.
6. `DELETE /devices/:id` revokes the device *and* its key; a subsequent `/api/capture` with that key
   returns 401.
7. Revoking a device belonging to another user returns 404, not 403 (no existence leak) — matching
   `apikey.service.revoke`.
8. `POST /api/capture { platform: 'claude-code' }` creates a suggestion when consent is unset,
   and creates **nothing** when `autoCapture['claude-code'] === false`.
9. Heartbeat updates `lastSeenAt` and is idempotent.
10. Existing extension pairing tests must pass **unchanged** after the service extraction — that is
    the proof the refactor was behaviour-preserving.

### 6.5 Backend exit criteria

A device can pair, capture, be listed, and be revoked; after revocation its key is dead; the
extension's own pairing tests are untouched and green; `vector-index.test.ts` still passes.

---

## 7. Desktop app plan

### 7.1 Where this lives

```
desktop/
  package.json
  electron.vite.config.ts
  electron-builder.yml
  src/
    main/                     # Node context — no renderer imports, ever
      index.ts                # app lifecycle, single-instance lock, tray
      tray.ts
      windows.ts
      config.ts               # electron-store-backed settings (watched paths, consent, pause)
      sources/
        session-source.ts     # the SessionSource interface
        claude-code.source.ts # JSONL transcripts (implemented + tested)
        cursor.source.ts      # stubbed — see §9
        codex.source.ts       # stubbed — see §9
      watcher.ts              # chokidar → debounce → source.parse()
      redact.ts               # secret scrubbing before anything leaves the machine
      queue.ts                # bounded, crash-safe outbound queue
      uploader.ts             # queue → POST /api/capture, backoff, 401 handling
      pairing.ts              # start → open dashboard → poll status → store key
      keychain.ts             # safeStorage-encrypted key at rest
    preload/
      index.ts                # contextBridge surface — the ONLY main↔renderer channel
    renderer/                 # React 19 + Tailwind v4, notebook tokens
      App.tsx
      screens/{Connect,Activity,Sources,Settings}.tsx
      components/…
```

### 7.2 Process architecture and security posture

Electron's defaults are not the safe ones. Every window is created with:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: join(__dirname, '../preload/index.js'),
}
```

plus:

- A strict CSP (`default-src 'self'`; no remote script), so a compromised renderer has no network
  reach of its own.
- `app.on('web-contents-created')` denies **all** `window.open` and blocks in-app navigation to any
  origin other than the app bundle. External links go through `shell.openExternal`, and only to the
  configured dashboard origin.
- A single-instance lock — two agents watching the same files would double-post.
- The API key **never enters the renderer**. It lives in the main process, encrypted at rest with
  Electron's `safeStorage` (Keychain on macOS, DPAPI on Windows). The preload surface exposes
  `pairing.start()`, `status.subscribe()`, `sources.*`, `capture.pause()` — verbs, not credentials.

### 7.3 Capture pipeline

```
chokidar (opted-in paths only)
  → debounce 2s (editors write atomically; a save is several fs events)
  → SessionSource.parse(file, sinceOffset)   → candidate snippets
  → redact()                                  → secrets stripped
  → dedupe (content hash, LRU)                → no repeats across restarts
  → queue.enqueue()                           → survives quit/crash/offline
  → uploader → POST /api/capture { snippet, platform }
  → server: consent gate → LLM extraction → MemorySuggestion (pending)
  → user reviews in the dashboard (or the app's Activity screen deep-links to it)
```

Every stage is a pure, separately testable function except `chokidar` and `uploader`. That is
deliberate: it is what makes this pipeline verifiable in CI without an OS event loop.

**`SessionSource` interface:**

```ts
export interface SessionSource {
  readonly platform: string;              // the /api/capture platform key
  readonly label: string;                 // user-visible, e.g. "Claude Code"
  defaultPaths(): string[];               // suggested watch roots, per-OS
  watchGlobs(): string[];
  parse(filePath: string, fromByte: number): Promise<{ snippets: string[]; nextByte: number }>;
}
```

Same shape family as `SiteAdapter` (Phase 8) and `ConversationImportProvider` (Phase 5): one
interface, N implementations, a host that never learns their names.

**Claude Code source.** Transcripts live at `~/.claude/projects/<slug>/<sessionId>.jsonl`, one JSON
object per line, with `type: "user" | "assistant"`, `message.content`, `timestamp`, `cwd`, and
`gitBranch`. `parse()` reads from a stored byte offset forward, so an appended line costs one
partial read, not a re-parse of a multi-megabyte file. Malformed or partially-flushed trailing lines
are skipped and the offset is left before them — a half-written line must never be dropped or
double-read.

**Redaction** (`redact.ts`) strips, before anything is queued: values assigned to
`KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL`-shaped identifiers, `sk-`/`ghp_`/`AKIA`-prefixed strings,
`Authorization:` header values, PEM blocks, and `.env`-style lines. It is a mitigation, not a
guarantee, and the Sources screen says exactly that rather than promising safety it cannot deliver.

**Queue.** Append-only JSONL in `app.getPath('userData')`, capped (default 500 items / 5 MB) with
oldest-dropped-first and a visible counter when dropping occurs. Retry with exponential backoff.
A `401` does not retry — it pauses capture and flips the app to a "reconnect" state, because a
revoked device retrying forever is how you turn a revocation into a log-flood.

### 7.4 Screens

| Screen | Contents |
|---|---|
| **Connect** | First run. One button → `pairing/start` → shows the 8-char code → opens `DASHBOARD_URL/dashboard/settings/api-keys?pair=<code>` in the system browser → polls status. Same visible-confirmation flow as the extension, same wording about what the device can and cannot do |
| **Activity** | What was captured, when, from which source, and its queue state (`queued` / `sent` / `failed`). US-INT-07 AC: *"the user can see what the agent has captured before it's finalized as a memory."* Sent items link to the dashboard's suggestion inbox |
| **Sources** | Per-source toggle + the exact watched paths, editable. **Everything is off until the user turns it on**, and the paths are shown as literal absolute paths — no "we watch your projects folder" hand-waving |
| **Settings** | Account, device name, pause capture, redaction preview, "Open dashboard", quit-on-close behaviour, and the version/update state |

Tray menu: capture on/off, queue depth, "Open activity", "Quit". Pause is reachable in one click
from anywhere, always.

### 7.5 Design direction

The notebook identity carries over unchanged — paper `#faf9f5`, ink `#191b22`, cobalt `#2c4be0`,
`--muted-foreground` `#5f636e` (the WCAG-AA-corrected value from Phase 12), the same display/body
pairing, the same restrained motion. A desktop shell is a new *rendering context*, not a licence for
a new *design language* — the identical reasoning recorded in Phase 8 §6.4 for the extension.

Two things the desktop context genuinely changes, and only these two: window chrome uses the native
title bar (a custom one buys nothing and breaks OS conventions), and the tray icon is a monochrome
template image so macOS and Windows each render it in their own idiom.

### 7.6 Testing

- **Vitest unit tests** on `redact`, `queue`, `claude-code.source` (including truncated-line and
  offset-resume cases), `dedupe`, and the uploader's backoff/401 behaviour, against fixture
  transcripts committed under `desktop/tests/fixtures/`.
- **A headless smoke launch** under `xvfb-run` asserting the app boots, creates its window, and
  exposes exactly the intended preload surface — the cheap test that catches a `contextIsolation`
  regression.
- Explicitly **not** claimed: real macOS/Windows runtime verification. See §9.

### 7.7 Desktop exit criteria

Pair from a cold start; drop a fixture transcript into a watched path; see a suggestion appear in
the dashboard inbox; toggle the platform off in Settings → Privacy and see the next capture produce
nothing; revoke the device from the dashboard and watch the agent pause itself.

---

## 8. Skills used, mapped to this phase

Extends the running table (Phases 1–12).

| Area | Skill | Why it matters specifically this phase |
|---|---|---|
| Discovery | `find-skills` | Searched for a desktop/Electron/Tauri/packaging skill — `npx skills find` returned **no matches** for "electron desktop app", "tauri", "desktop app", "native app". Recorded so nobody re-searches; if one appears, extend this document |
| New adapter seam | `codebase-design` | `SessionSource` is the third member of the `SiteAdapter`/`ConversationImportProvider` family. Getting the boundary right is what makes a Cursor adapter a file, not a refactor |
| Process/trust boundaries | `domain-modeling` | "What is a device, when is it revoked, and what does revocation mean to an in-flight queue" must be answered before `DesktopAgentDevice` is a table |
| Test-first | `tdd` | Pairing replay, cross-client code confusion, offset-resume on a truncated JSONL line — all look right and are silently wrong. Red tests first |
| Backend idioms | `nodejs-backend-patterns`, `nodejs-best-practices` | The extracted `device-pairing.service` must stay a deep module: callers still never see a raw key |
| Schema work | `prisma-cli`, `prisma-client-api` | `@@map` rename + column add without a data move, and the vector-index drift trap |
| Visual consistency | `frontend-design`, `high-end-visual-design`, `web-design-guidelines` | New shell, same identity (§7.5) |
| Component reuse | `vercel-composition-patterns` | Activity rows and the pairing card are ports of existing dashboard components, not parallel builds |
| Review | `code-review` | Electron's insecure defaults are the highest-value review target in this phase |

---

## 9. Honest constraints — stated up front, not discovered later

1. **Signed macOS `.dmg` and Windows `.exe` artifacts cannot be produced in this environment.**
   Notarization requires macOS and an Apple Developer identity; Authenticode requires a Windows
   signing certificate. This phase delivers the `electron-builder` configuration and a
   `macos-latest` / `windows-latest` GitHub Actions release workflow, both **unrun**. Shipping
   installers is an out-of-environment step and is written into the Build Status Report as such.
2. **Only the Claude Code transcript format is verifiable here.** Real Claude Code JSONL sessions
   exist on this machine and are used as fixtures. Cursor and Codex store session data in formats
   this environment has no sample of; their adapters ship as documented stubs that are visibly
   disabled in the Sources screen with the reason shown. This matches the posture already taken for
   Phase 5's chat import (2 of 6 platforms) and Phase 8's site adapters — a listed-but-unverified
   integration is worse than an honestly-absent one.
3. **Redaction is best-effort.** Pattern-based scrubbing catches common credential shapes; it cannot
   catch a secret that looks like prose. The UI says so.
4. **Auto-update is wired but off.** It cannot be meaningfully tested without signed builds.

---

## 10. Delivery order

1. Backend: `DevicePairingCode` rename + `client` column + `DesktopAgentDevice`; migration; verify
   vector indexes survived (tests first — §6.4 items 1–5, 10)
2. Backend: extract `shared/device-pairing.service.ts`; re-point the extension at it; existing
   extension tests must pass unchanged
3. Backend: `modules/desktop/` service, controller, routes; device revoke + heartbeat (§6.4 items
   6–9)
4. Frontend: Settings → Devices tab (list, last seen, revoke) + three new platform rows in
   Settings → Privacy
5. Desktop: package scaffold, `electron.vite.config.ts`, secure `BrowserWindow` defaults, tray,
   single-instance lock
6. Desktop: `redact` / `queue` / `dedupe` / `claude-code.source` with unit tests **first**
7. Desktop: pairing + `safeStorage` key persistence, end-to-end against the new endpoints
8. Desktop: watcher + uploader wiring
9. Desktop: renderer screens with the notebook tokens
10. Packaging: `electron-builder.yml`, CI release matrix, README/runbook updates
11. `code-review` pass focused on the Electron trust boundary; update
    `docs/Build_Status_Report.md` with what is verified and what is not

---

## 11. Alignment with prior phases

- **Phase 8 (extension):** identical pairing UX, identical scope-restriction reasoning, identical
  "second client, not second product" framing. The shared pairing service means a future third
  client (a CLI, a mobile app) is a config object.
- **Phase 11 (privacy):** the desktop agent adds three rows to an existing consent surface and
  nothing else. It has no consent mechanism of its own, which is exactly why it cannot drift from
  the one that exists.
- **Phase 10 / payments flag:** the agent asks no plan questions. Capture is not plan-gated, so
  `entitlements.ts` needs no new caller — worth stating because a "Pro-only desktop app" would have
  been a plausible and wrong default.
- **Phase 12 (QA):** desktop unit tests join the existing CI workflow as a fourth job.

---

## 12. Traceability checklist

| Requirement | Where it's satisfied |
|---|---|
| US-INT-07 — lightweight desktop agent captures coding-session context | §7.3 pipeline, §7.1 `desktop/` |
| US-INT-07 AC — explicit, visible authorization; no silent enrollment | §6.3 session-only `claim`, §7.4 Connect screen |
| US-INT-07 AC — user sees what was captured before it's finalized | §7.4 Activity screen + unchanged `MemorySuggestion` flow |
| US-MEM-03 — nothing saved without review | §6.2 (no capture-service change), §6.4 test 8 |
| US-ACC-07 — per-platform auto-capture consent | §6.2 platform keys, §10 step 4 |
| US-ACC-03 — keys shown once | §6.2 one-shot delivery reused verbatim |
| US-SEC-02 — no training, no sale | Unchanged; the agent adds no new data sink |
| `Backend_Plan.md` — `DesktopAgentDevice` device channel | §6.1 |

---

## 13. Definition of done

- All §6.4 tests green, including the untouched extension pairing tests and `vector-index.test.ts`.
- Desktop unit tests green; the `xvfb-run` smoke launch boots and exposes only the intended preload
  surface.
- A fixture Claude Code transcript, dropped into a watched path, produces a pending suggestion in
  the dashboard — and produces nothing when that platform's consent toggle is off.
- Revoking the device from the dashboard stops the agent within one request.
- §9's constraints are reflected in `docs/Build_Status_Report.md`, not just here.
