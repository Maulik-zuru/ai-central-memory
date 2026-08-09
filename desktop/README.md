# MemoryOS Desktop Agent

A small Electron app for macOS and Windows that watches the local AI coding-session folders you
explicitly turn on, and feeds what it finds into the same review-first memory pipeline the browser
extension uses.

Plan: [`docs/Phase13_DesktopAgent_Implementation_Plan.md`](../docs/Phase13_DesktopAgent_Implementation_Plan.md).

## What it does, and what it deliberately does not

It reads files under folders you choose, strips credential-shaped text before anything leaves the
machine, and posts snippets to `POST /api/capture`. The server decides the rest: your per-platform
consent setting decides whether the snippet is looked at, and anything that survives becomes a
**pending suggestion** you approve in the dashboard — never a saved memory on its own.

It does **not** watch your keyboard, clipboard, or screen, and asks for no accessibility or input
-monitoring permission. Capture is off until you turn it on, and pause is one click away in the
menu bar.

## Running it locally

```bash
npm install
VITE_API_BASE_URL=http://localhost:4000 VITE_DASHBOARD_URL=http://localhost:3000 npm run dev
```

Both origins are explicit environment variables with production defaults — one cannot be derived
from the other, a lesson paid for in the browser extension.

## Checks

```bash
npm test        # pipeline unit tests (redact, queue, source parser, uploader)
npm run typecheck
npm run smoke   # headless boot; asserts the renderer sees only the preload bridge
```

`npm run smoke` needs `xvfb` on Linux. It is the gate against a `contextIsolation` or sandbox
regression, which is otherwise invisible in a diff.

## Packaging

```bash
npm run package:mac   # requires macOS + an Apple Developer identity for a usable artifact
npm run package:win   # requires a Windows Authenticode certificate
```

Neither has been run. Unsigned builds will be refused by Gatekeeper and warned about by SmartScreen
— see the phase plan §9 and `docs/Operations_Runbook.md` §5.

## Adding a source

Implement `SessionSource` (`src/main/sources/session-source.ts`) and add it to
`src/main/sources/index.ts`. Write the fixture tests before flipping `available` to `true`;
`claude-code.source.ts` and its tests are the reference, including the offset-resume and
partially-written-line rules an implementation has to honour.
