# AI Memory & Context Platform — Frontend Build Plan (Phase-Wise)

**Companion document:** `Backend_Plan.md` (same phase numbers, so the two teams can build in lock-step)

---

## 1. Purpose & Scope

This plan scopes the frontend build for an in-house clone of the MemoryPlugin product category: a
cross-AI **memory + chat-history + file** context layer, surfaced through a dashboard, a browser
extension, and integration setup screens. It is organized into 13 phases (0–12), each shippable and
independently testable, so the product can go from skeleton → MVP → full feature parity → hardened
launch without a big-bang release.

Everything in the source feature inventory (Account, Memory, Organization, Chat Archive, Files, Ask,
Integrations, Infrastructure/Intelligence, Security) is placed into a phase — see the **Feature
Coverage Matrix** in Section 6 for the full mapping.

## 2. Product Snapshot (what the UI needs to represent)

- **Memories** — small curated facts, organized into **buckets**, editable, versioned, deduplicated.
- **Chat History** — an imported/synced archive of past AI conversations, searchable by meaning, not
  just keyword, with summaries and transcripts.
- **Files** — uploaded documents (PDF/Word/Markdown/Text) queryable via RAG, with page/section
  citations.
- **Ask** — one unified chat-style query box that can search any combination of the three data layers
  and cites its sources.
- **Integrations** — a browser extension, MCP connection, Custom GPT, TypingMind plugin, public API,
  desktop sync agent, and agent-skill packages, all configured from the dashboard.

## 3. Assumptions & Tech Stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| Web dashboard | Next.js 14+ (App Router), TypeScript | SSR for marketing/pricing, CSR for app |
| Styling / components | Tailwind CSS + shadcn/ui | Fast, consistent, themeable |
| State/data fetching | TanStack Query + Zustand | Server cache vs. local UI state split cleanly |
| Forms/validation | React Hook Form + Zod | Zod schemas shared with the Express backend so validation logic isn't duplicated |
| Browser extension | Manifest V3, React content scripts, Vite bundler | Chrome first, Safari/Firefox behind polyfills |
| Realtime/progress | WebSocket or SSE client | For sync progress, file processing status |
| Mobile | Responsive web (PWA) in Phase 1–12 | Native app is an explicit stretch item, not in scope |
| Auth | NextAuth-style session + API-key screens | OAuth (Google) + email/password |

## 4. Global UI/UX Principles

- **One context model everywhere:** bucket filters, source citations, and "what will be injected"
  previews use the same visual language across Memory, Chat History, Files, and Ask.
- **Trust through transparency:** every AI-touching action (auto-capture, Quick Inject, Ask answer)
  shows *what* was captured/sent and lets the user undo or edit it before it's final.
- **Low-friction capture:** one-click save and Quick Inject must be reachable in ≤2 clicks from any
  supported AI page.
- **Progressive disclosure:** Core-tier users see a simple notebook; Pro-tier surfaces (knowledge
  graph, insights, analytics) appear as additional panels, not a different app.

---

## 5. Phase-Wise Delivery Plan

### Phase 0 — Foundations & Environment Setup
**Objective:** Repo, design system, and CI ready before any feature work starts.
- Monorepo scaffold (dashboard app, extension app, shared `ui/` and `types/` packages)
- Design tokens (color, spacing, type) implemented as Tailwind config + shadcn theme
- Storybook (or equivalent) for shared components
- Environment configs (dev/stage/prod), `.env` handling, preview deployments
- Lint/format/test/CI pipeline; error tracking (Sentry) and analytics wired but empty
**Deliverables:** Empty shell app deployed to staging with design system loaded.
**Exit criteria:** A new component can be built, previewed in Storybook, and deployed within a day.

### Phase 1 — Accounts, Auth & Dashboard Shell
**Objective:** A user can sign up, log in, and land on an empty but real dashboard.
- Marketing/landing page (optional, low priority) + Sign up / Log in / Forgot password
- OAuth login (Google) alongside email/password
- Dashboard shell: left nav (Memories / Chat History / Files / Ask / Buckets / Settings), top bar,
  account menu
- Account & profile settings page
- **API key management UI** — generate, name, revoke, copy keys
- Empty states for every future section (so nav doesn't feel broken pre-Phase 2)
**Depends on:** Phase 0. **Feeds:** Backend Phase 1 (auth/user/API-key services).
**Exit criteria:** New user can register, log in, generate an API key, and see a stable shell.

### Phase 2 — Core Memory System ("The Notebook")
**Objective:** The primary memory notebook is fully usable end-to-end.
- Memory list/grid with search + filters
- Create/edit/delete memory (manual capture) modal
- **One-click save** widget (from extension context, wired later in Phase 8, UI built now)
- **Image memory** upload and thumbnail/lightbox view
- Memory detail panel with **version history** timeline (diff view between versions)
- **Memory suggestions inbox**: duplicate detection cards and stale-memory cards, each with
  Approve / Dismiss / Merge actions
- "Unlimited memory" — no artificial UI cap; pagination/virtualized list for scale
**Depends on:** Phase 1. **Feeds:** Backend Phase 2 (memory CRUD, capture pipeline, dedupe/stale jobs).
**Exit criteria:** A user can create, edit, merge, and review the history of a memory without leaving
this section.

### Phase 3 — Buckets & Organization
**Objective:** Memories (and later files/chats) can be organized and shared.
- Bucket sidebar tree (Personal / Work / Project / Custom, nestable)
- Create/rename/delete bucket, drag-and-drop or multi-select assignment of memories to buckets
- Bucket-based filtering reused across Memory list, Files, and Ask (built as one shared component)
- **Shared buckets**: invite-by-email flow, role selector (viewer/editor), pending-invite state,
  member list with remove/role-change
**Depends on:** Phase 2. **Feeds:** Backend Phase 3 (bucket schema, RBAC, invitations).
**Exit criteria:** A user can create a "Client A" bucket, move memories into it, and invite a
teammate as an editor.

### Phase 4 — Smart Memory & Context Retrieval Engine (UI surface)
**Objective:** Make the "only send what's relevant" behavior visible and controllable.
- Smart Mode on/off toggle (dashboard + extension)
- **Context preview panel**: shows exactly which memories/categories would be injected for the
  current conversation before it happens
- Token-savings indicator ("Smart Memory reduced this injection by ~86%")
- Category browser (auto-generated memory categories, editable labels)
**Depends on:** Phase 2–3. **Feeds:** Backend Phase 4 (categorization + retrieval engine).
**Exit criteria:** Turning Smart Mode on visibly changes what would be injected, and the user can see
why.

### Phase 5 — Chat History Archive (Import + Sync)
**Objective:** Users can bring in and browse their AI conversation history.
- Import wizard: choose provider (ChatGPT / Claude / Gemini / TypingMind / Grok / DeepSeek), choose
  scope (last 500 vs. unlimited, per plan)
- Sync settings: enable/disable per platform, view sync limits, cancel an in-progress sync
- Sync progress UI (live count, errors, "resync" affordance) — idempotent, so re-running never
  duplicates entries in the UI
- Conversation archive browser (list + preview pane), **full transcript viewer**
- **Semantic search bar** over history ("what did I decide about the database migration?")
- **Conversation summaries** (Pro) and **monthly insights** (Pro) panels
**Depends on:** Phase 1, 3. **Feeds:** Backend Phase 5 (connectors, sync jobs, embeddings, summarizer).
**Exit criteria:** A user can import a ChatGPT export, watch it sync, search it semantically, and open
a full transcript.

### Phase 6 — Files & Document Knowledge Base (RAG)
**Objective:** Documents become queryable knowledge, organized like memories.
- File upload (drag-drop + picker) for PDF / Word / Markdown / Text, with processing-status badges
- File buckets (reuses Phase 3 bucket component)
- File list with search/filter, preview pane
- **File Q&A** chat panel with inline **page/section citations**, click-to-jump-to-source
**Depends on:** Phase 3. **Feeds:** Backend Phase 6 (parsing, chunking, vector index, RAG query).
**Exit criteria:** A user uploads a contract PDF and asks "what's the termination period?" and gets an
answer with a clickable page reference.

### Phase 7 — The "Ask" Unified Query System
**Objective:** One search/chat surface across all three data layers.
- Ask chat interface (persistent, resumable threads)
- **Mode selector**: Memories / Chat History / Files / All
- **Source reference chips** under each answer, expandable to show the underlying memory / chat
  snippet / file excerpt
- **Saved Ask conversations** list, resumable
- Bucket filter within Ask (scope a question to one client/project)
- Copy-response action
**Depends on:** Phases 2, 5, 6. **Feeds:** Backend Phase 7 (query router + synthesis + citations).
**Exit criteria:** A single question can be answered by blending a memory, a past conversation, and a
document, with all three sources shown and clickable.

### Phase 8 — Cross-AI Integrations
**Objective:** The platform's context becomes usable *inside* other AI tools.
- **Browser extension**: memory panel, bucket selector in-page, memory count badge, Smart Mode
  toggle, edit/delete inline, **Quick Inject** button + smaller inline button near the chat input,
  onboarding walkthrough (replayable from settings), settings popup
- Dashboard **Integrations** hub: connection cards for Custom GPT, MCP (hosted + local, with copyable
  config/token), TypingMind plugin, Open API (interactive docs + key generator reused from Phase 1),
  Desktop app (macOS) pairing flow for Claude Code / Codex / Cursor sync
- **Agent Skills** page: list of installable skill packages for Claude Code / Codex / Cursor, with
  copy-to-clipboard install commands
- Platform compatibility matrix page (which of the 20+ AI tools are supported and how — extension,
  MCP, or native plugin)
**Depends on:** Phases 2–7 (this phase exposes them externally). **Feeds:** Backend Phase 8.
**Exit criteria:** From a supported AI's chat page, a user can Quick-Inject a bucket's memories in
two clicks, and can connect Cursor via MCP from the dashboard in under five minutes.

### Phase 9 — Advanced Intelligence (Pro tier)
**Objective:** Surface the higher-order intelligence features as visual, explorable panels.
- **Knowledge graph** visualization (interactive node/edge explorer, click a node to see source memory
  or conversation)
- **Usage analytics** dashboard (memories created, tokens saved, Ask usage, sync volume, per time range)
- Monthly insights digest view (reuses summary components from Phase 5)
**Depends on:** Phases 2, 5. **Feeds:** Backend Phase 9.
**Exit criteria:** A Pro user can explore how "Project X" connects to "Client A" and "TypeScript" as a
graph, and see a monthly usage/insights digest.

### Phase 10 — Billing, Plans & Monetization
**Objective:** Core vs. Pro is enforced and upgradeable in the UI.
- Pricing page reflecting Core vs. Pro feature lists (with the 7-day trial and refund policy stated)
- Plan selection / upgrade / downgrade flow, Stripe-hosted checkout embed
- Trial countdown banner, usage-limit warnings (e.g., approaching last-500-conversations cap)
- Billing/invoice history page
- Feature-gating UI: locked-state cards for Pro features shown to Core users with an upgrade CTA
**Depends on:** Phase 1. **Feeds:** Backend Phase 10.
**Exit criteria:** A Core user hitting a Pro-only feature sees a clear, non-blocking upgrade path.

### Phase 11 — Security, Privacy & Compliance
**Objective:** Users can see and control what happens to their data.
- Privacy & data settings page: encryption status indicators, "not used for training" statement,
  "not sold" statement
- **Data export** flow (request → email/download link → status)
- **Account/data deletion** flow with clear, explicit confirmation and scope (what gets deleted)
- Consent/preference toggles (e.g., automatic capture on/off per platform)
- Session/device management (active sessions, revoke)
**Depends on:** Phase 1. **Feeds:** Backend Phase 11.
**Exit criteria:** A user can export all their data and, separately, permanently delete their account
from the UI alone.

### Phase 12 — QA, Performance & Launch Readiness
**Objective:** Ship-ready polish across surfaces.
- Cross-browser/extension compatibility pass (Chrome, Safari, Firefox where feasible)
- Accessibility audit (keyboard nav, contrast, screen-reader labels) on all Phase 1–11 screens
- Performance pass: code splitting, image optimization, virtualization on large lists, Lighthouse
  budget enforcement in CI
- Full onboarding flow polish (first-run empty states, guided tour)
- Mobile-web pass (iOS Safari, Android browser) per the source's mobile-support requirement
**Depends on:** All prior phases. **Exit criteria:** Green accessibility/perf budgets in CI; onboarding
completes end-to-end on desktop and mobile web.

---

## 6. Feature Coverage Matrix (frontend-owned surface)

### Account
| Feature | Phase |
|---|---|
| Registration/login | 1 |
| Dashboard shell | 1 |
| API key management UI | 1 |
| Subscription / plan management UI | 10 |
| Data export UI | 11 |
| Data deletion UI | 11 |
| Privacy controls UI | 11 |

### Memory
| Feature | Phase |
|---|---|
| Automatic capture (confirmation UI) | 2 |
| Manual capture / one-click save | 2 |
| Edit / Delete | 2 |
| Image memories | 2 |
| Memory suggestions (duplicate/stale) UI | 2 |
| Approve/Dismiss/Merge actions | 2 |
| Version history UI | 2 |
| Unlimited memory (scalable list UI) | 2 |
| Smart Memory controls & preview | 4 |
| Memory recall (via Ask) | 7 |

### Organization
| Feature | Phase |
|---|---|
| Buckets (personal/work/project/custom) | 3 |
| Bucket filtering | 3, reused in 6 & 7 |
| Shared buckets + team invitations | 3 |

### Chat Archive
| Feature | Phase |
|---|---|
| Import UI (6 platforms) | 5 |
| Automatic sync UI + progress | 5 |
| Semantic conversation search UI | 5 |
| Full transcripts viewer | 5 |
| Conversation retrieval / browser | 5 |
| High-accuracy recall (surfaced via search relevance) | 5 |
| Conversation summaries (Pro) | 5 |
| Monthly insights (Pro) | 5, 9 |
| Usage analytics (Pro) | 9 |
| Knowledge graph (Pro) | 9 |

### Files
| Feature | Phase |
|---|---|
| File upload (PDF/Word/MD/Text) | 6 |
| File buckets | 6 |
| File search | 6 |
| Page/section references | 6 |
| File Q&A | 6 |

### Ask
| Feature | Phase |
|---|---|
| Memories / Chat History / Files / All modes | 7 |
| Natural-language querying | 7 |
| Source references (clickable) | 7 |
| Saved Ask conversations | 7 |
| Bucket filtering in Ask | 7 |
| Copy response | 7 |

### Integrations
| Feature | Phase |
|---|---|
| Browser extension (Chrome/Safari), Quick Inject, onboarding | 8 |
| Mobile browser support | 8, 12 |
| Custom GPT setup UI | 8 |
| MCP (hosted + local) connection UI | 8 |
| TypingMind plugin config UI | 8 |
| Open API docs/key UI | 1, 8 |
| Desktop app pairing UI | 8 |
| Agent Skills install UI | 8 |

### Infrastructure / Intelligence (UI-visible parts)
| Feature | Phase |
|---|---|
| Context selection preview | 4 |
| Token optimization indicator | 4 |
| Source attribution (Ask) | 7 |
| AI summarization (surfaced) | 5 |
| Knowledge graph (surfaced) | 9 |

### Security (UI-visible parts)
| Feature | Phase |
|---|---|
| Encryption status / trust messaging | 11 |
| Export / permanent deletion controls | 11 |
| Consent toggles | 11 |

---

## 7. Non-Functional Requirements

- **Browser support:** latest Chrome, Safari, Firefox for the extension; evergreen browsers for the
  dashboard.
- **Accessibility:** WCAG 2.1 AA target on all core flows (Phase 12 gate).
- **Performance:** dashboard TTI < 2.5s on mid-tier hardware; virtualized lists for >1k memories.
- **Mobile:** responsive web required (Phase 12); native app explicitly out of scope for v1.
- **i18n:** structure copy for future localization, but ship English-only in v1.

## 8. Risks & Open Questions

- Extension **Manifest V3** limits background-script persistence — sync/inject architecture needs to
  account for this early (flagged for Phase 8 design review).
- Safari extension distribution requires a separate signing/notarization process — budget time in
  Phase 8/12.
- Knowledge graph visualization at scale (thousands of nodes) needs a rendering strategy decision
  (canvas/WebGL vs. SVG) before Phase 9 starts.

## 9. Note on Originality

This plan clones the **feature set and information architecture** described in the source analysis,
not any of MemoryPlugin's copyrighted text, visual design, or branding. All copy, layouts, and visual
design in the actual build should be original work product.
