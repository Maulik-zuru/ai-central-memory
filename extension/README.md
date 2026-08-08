# AI Memory & Context — Browser Extension

Manifest V3 Chrome extension implementing the browser-extension slice of Phase 8 ("Cross-AI
Integrations"). See `docs/Phase8_BrowserExtension_Implementation_Plan.md` in the repo root for
the full design rationale — this file covers what a contributor working in this package
specifically needs to know.

## Development

```sh
npm install
npm run dev      # Vite + CRXJS dev server with HMR
npm run build    # production build → dist/
npm run typecheck
```

Load `dist/` (after `npm run build`) as an unpacked extension via `chrome://extensions` →
Developer mode → "Load unpacked". For `npm run dev`, CRXJS supports loading the dev build the
same way and hot-reloads on save.

`src/lib/config.ts`'s `API_BASE_URL` points at `http://localhost:4000` in dev
(`import.meta.env.DEV`) and a production placeholder otherwise — update it to the real API origin
before shipping, and keep `manifest.config.ts`'s `host_permissions` in sync with it exactly.

## Design direction — do not "fix" this back to a generic look

`Phase8_BrowserExtension_Implementation_Plan.md` §6.4 ran a UI/UX design-intelligence query
(`ui-ux-pro-max`) against this extension's brief. Its default color/typography recommendation (a
teal/orange palette, Inter) was **deliberately overridden**. The dashboard
(`frontend/src/app/globals.css`) already has an intentional visual identity — paper background
`#faf9f5`, ink `#191b22`, a single cobalt accent `#2c4be0` — and this extension must read as the
*same product* seen through a smaller window, not a second brand invented because it happens to
live in a separate codebase. `src/popup/styles.css` and `src/content/shadow-styles.ts` both
re-declare these exact token values (a separate build with no shared stylesheet pipeline — see
"Why a separate package" below).

What *was* adopted from that design query, because these are genuinely new decisions (nothing
before this extension lived in a content-script/popup context):

- Micro-interactions: hover feedback in 150–300ms, ≤2px displacement, animating only
  `transform`/`opacity` — a content script shares the host page's main thread, so a
  layout-thrashing animation would visibly jank the host AI site.
- Toast/confirmation timing: save confirmations auto-dismiss in 3–5 seconds; Quick Inject requires
  an explicit confirm click rather than injecting instantly.
- Accessibility baseline: 44×44px minimum hit targets even in the compact popup, visible focus
  rings, `prefers-reduced-motion` respected, 4.5:1 text contrast (inherited from the dashboard
  palette, already verified there).
- Icon discipline: no emoji in the injected UI — it sits inside someone else's product (ChatGPT,
  Claude.ai, Gemini) and should read as a serious tool, not a browser toy.

**If you're tempted to swap the palette for something more "on-brand for a browser extension,"
don't** — that instinct is exactly the generic-tool default this document overrode on purpose.

## Why a separate package, not a shared workspace

This repo has never adopted npm/pnpm workspaces (`backend/`, `frontend/`, and this `extension/`
are three independent packages). A handful of types (`Memory`, `Bucket`, `ContextPreview`, a few
others in `src/lib/types.ts`) are duplicated from `frontend/src/lib/api.ts` rather than imported
from a shared package. This is an accepted, small amount of duplication — introducing workspace
tooling for three shared interfaces would be a bigger change to the repo's build shape than the
duplication it would remove.

## Architecture

Three Manifest V3 contexts, communicating only through `src/lib/messages.ts`'s
`chrome.runtime.sendMessage` protocol:

- **`src/background/`** — the only context with `host_permissions` for the API's origin
  (`api.ts`'s `apiFetch`). Content scripts and the popup never call the API directly; they relay
  through here. Written stateless-per-message since MV3 can terminate and restart this worker
  between messages — everything that matters is in `chrome.storage`, not module-level variables.
- **`src/content/`** — one bundle, gated per-origin by `src/lib/site-adapters/`'s
  `getActiveAdapter()`. Renders into a closed `ShadowRoot` (`index.tsx`) so its styles never leak
  into the host page and the host page's scripts can't inspect or restyle it.
- **`src/popup/`** — the toolbar-icon panel: pairing/connect screen, recent memories + search,
  bucket selector, Smart Mode toggle, settings.

## Known gaps (tracked, not silently missing)

- **Site adapters are unverified against live pages.** `src/lib/site-adapters/{chatgpt,claude,gemini}.ts`
  encode best-effort DOM selectors based on each platform's structure as of when this was written.
  None have been exercised against a live, authenticated session in the environment this was
  built in — every AI chat UI ships DOM changes without notice, and this is exactly the kind of
  assumption that needs a real-browser check before shipping. **Do this before publishing to the
  Chrome Web Store**, not after a user reports Quick Inject silently doing nothing.
- **Four platforms beyond the launch three (ChatGPT, Claude.ai, Gemini) have no adapter** — the
  PRD's "20+ AI tools" ambition is out of scope for this slice, same call
  `Phase5_Implementation_Plan.md` made for four unparsed chat-import platforms. Adding one is a
  new file in `src/lib/site-adapters/`, not a rewrite of the content-script host.
- **Safari/Firefox are out of scope** — Chrome-first per `Frontend_Plan.md` §7; Safari's separate
  signing/notarization process is a distinct future budget item.
- **The other six Phase 8 sub-systems** (MCP server, Custom GPT actions, TypingMind plugin, Open
  API public docs, desktop sync agent, Agent Skills) are not part of this package at all — see
  `Phase8_BrowserExtension_Implementation_Plan.md` §3's "Phase 8b" note.
