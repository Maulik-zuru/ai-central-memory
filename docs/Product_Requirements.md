# AI Memory & Context Platform — Product Requirements (Source of Truth)

**Companion documents:** `Frontend_Plan.md`, `Backend_Plan.md` (same phase numbers throughout)

---

## 0. How to use this document

- **This document is the source of truth for *what* gets built and *why*.** `Frontend_Plan.md` and
  `Backend_Plan.md` are the source of truth for *how* and *in what order*. If scope or behavior ever
  seems to disagree between documents, this one wins; if sequencing or technical approach disagrees,
  the phase plans win.
- **ID scheme:** every requirement is a user story `US-{EPIC}-{NN}` (e.g. `US-MEM-06`). Reference these
  IDs in tickets/commits/PRs for traceability back to this document.
- **Priority** uses MoSCoW: **Must** (v1 blocking), **Should** (v1 target, can slip one phase),
  **Could** (nice-to-have, cut first under time pressure).
- **Tier** is **Core** or **Pro** — matches the plan gating in Backend Phase 10.
- **Phase** cross-references `Frontend_Plan.md` / `Backend_Plan.md` as `FE-#` / `BE-#`.
- **Acceptance criteria** are the minimum testable bar for calling a story done — not an exhaustive
  edge-case list. The most behaviorally tricky stories get full Given/When/Then specs; the rest get a
  condensed checklist.

---

## 1. Product Overview

A cross-AI context layer built on three data stores — **Memories**, **Chat History**, **Files** —
retrievable through one unified **Ask** interface and injectable into 20+ external AI tools via a
browser extension, MCP, Custom GPT, a TypingMind plugin, a public API, and a desktop sync agent. Full
system architecture lives in `Backend_Plan.md`; UI structure lives in `Frontend_Plan.md`. This document
defines what every piece must actually do.

## 2. Personas

| Persona | Description | Primary needs |
|---|---|---|
| **P1 — Power user** | Individual professional using ChatGPT, Claude, Gemini, and Cursor/Claude Code across a workday | Save something once, have it show up everywhere, without repeating context |
| **P2 — Team lead (Pro)** | Manages multiple client/project contexts, works with teammates | Isolate "Client A" from "Client B," share specific context, control who sees what |
| **P3 — Builder/integrator** | Developer connecting the platform to their own agents or internal tools | Reliable API/MCP access, predictable auth, documented contracts |

## 3. Glossary

| Term | Meaning |
|---|---|
| **Memory** | A single curated fact or preference, saved manually, via one-click, or via automatic capture |
| **Bucket** | A named grouping of memories/files (and their sharing settings) — e.g. "Personal," "Client A" |
| **Chat History / Archive** | Imported (and optionally synced) copies of past AI conversations — distinct from memories |
| **Smart Memory** | The retrieval subsystem that selects a small relevant subset of context instead of sending everything |
| **Ask** | The unified query interface across Memories, Chat History, and Files, with cited answers |
| **Quick Inject** | A one-click extension action that pushes a bucket's assembled context into the current AI chat |
| **RAG** | Retrieval-Augmented Generation — retrieving relevant chunks and grounding an LLM answer in them |
| **MCP** | Model Context Protocol — lets tools like Claude Code/Cursor call this platform's search/save functions directly |

## 4. Scope & Tiers

| Capability area | Core | Pro |
|---|---|---|
| Memories, buckets, Smart Memory | ✅ | ✅ |
| File Q&A, image memories, version history | ✅ | ✅ |
| Chat history import/sync | Last 500 conversations | Unlimited |
| Conversation summaries, monthly insights | — | ✅ |
| Knowledge graph, usage analytics | — | ✅ |
| Shared buckets | — | ✅ |
| 21+ AI platform integrations, MCP, API | ✅ | ✅ |

## 5. Out of Scope / Non-Goals (v1)

- Native iOS/Android app — responsive web only (native is a future stretch item)
- Cross-account/team benchmarking analytics (usage analytics is single-account only)
- Non-English UI or content localization
- Any model fine-tuning or training on user data, under any plan (see `US-SEC-02` — this is a hard
  non-goal, not a deferred feature)
- Guaranteed support for AI platforms beyond the initial integration list (extensible later, not a v1
  blocker)

## 6. Assumptions & Dependencies

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui (confirmed).
- **Backend:** Express.js, TypeScript, PostgreSQL, Prisma (confirmed).
- Depends on continued third-party LLM API access (capture extraction, categorization, summarization,
  Ask synthesis) — an outage degrades Smart Memory/Ask but should not take down basic CRUD.
- Depends on each target AI platform's extension surface, export format, or public API remaining
  stable enough to integrate against; breakage on one platform must not block the others (see
  `Backend_Plan.md` §8 risks).

---

## 7. Functional Requirements (User Stories by Epic)

### 7.1 Account & Access — `Phase FE-1 / BE-1, 10, 11`

#### US-ACC-01 — Sign up and log in
*As a new user, I want to register and log in with email/password or Google, so that I can access my own context.*
- AC: registration validates email format and password strength; Google OAuth completes without a separate password step; failed login shows a clear error without revealing whether the email exists.
- Priority: Must · Tier: Core

#### US-ACC-02 — Dashboard shell and navigation
*As a logged-in user, I want a consistent dashboard with clear navigation, so that I can find Memories, Chat History, Files, Ask, and Buckets without hunting.*
- AC: all five sections reachable within one click from any page; empty states explain what each section is for before any data exists.
- Priority: Must · Tier: Core

#### US-ACC-03 — API key management
*As a builder, I want to generate, name, and revoke API keys, so that I can integrate my own tools safely.*
- AC: key shown in full only once at creation; revoked keys fail auth immediately (not on next cache refresh); each key shows last-used timestamp.
- Priority: Must · Tier: Core

#### US-ACC-04 — Plan and subscription visibility
*As a user, I want to see my current plan, trial status, and usage against plan limits, so that I'm not surprised by a limit or a charge.*
- AC: trial countdown visible once inside the trial window; approaching a plan limit (e.g. conversation import cap) shows a warning before the limit is hit, not just after.
- Priority: Should · Tier: Core

#### US-ACC-05 — Data export
*As a user, I want to export all my data, so that I have a copy independent of the platform.*
- AC: export includes memories, chat history, and file metadata (not just a subset); user receives a completion notification with a download link; link expires after a reasonable window.
- Priority: Must · Tier: Core

#### US-ACC-06 — Permanent account and data deletion
*As a user, I want to permanently delete my account and all associated data, so that I have real control over my information.*
- AC: deletion requires explicit confirmation (typed confirmation or equivalent friction, not a single accidental click); user is told what will be deleted before confirming. Full cascade behavior is specified in `US-SEC-04`.
- Priority: Must · Tier: Core

#### US-ACC-07 — Privacy and auto-capture consent controls
*As a user, I want to control whether automatic capture is on, and per which platform, so that I decide what gets remembered.*
- AC: auto-capture can be disabled globally or per connected platform; disabling it stops new automatic suggestions without deleting existing memories.
- Priority: Should · Tier: Core

#### US-ACC-08 — Session and device management
*As a user, I want to see and revoke active sessions/devices, so that I can respond if I think my account is compromised.*
- AC: session list shows device/browser and last-active time; revoking a session invalidates it within the request cycle, not just on next token refresh.
- Priority: Should · Tier: Core

---

### 7.2 Memory ("The Notebook") — `Phase FE-2 / BE-2`

#### US-MEM-01 — Manual memory creation
*As a user, I want to type and save a memory directly, so that I can add context the AI didn't pick up on its own.*
- AC: empty content is rejected; new memory appears at the top of the list immediately; embedding generation is queued automatically, not blocking the save.
- Priority: Must · Tier: Core

#### US-MEM-02 — One-click save from the extension
*As a user chatting in a supported AI tool, I want to save something with one click, so that capture doesn't interrupt my flow.*
- AC: save completes in under 2 seconds from click to confirmation; the saved text matches exactly what was highlighted/selected, with no silent LLM rewriting.
- Priority: Must · Tier: Core

#### US-MEM-03 — Automatic capture with confirmation
*As a user, I want the system to notice worth-remembering information during a conversation and ask before saving it, so that nothing is stored without my awareness.*
- AC: a draft memory is shown for approval before it is persisted; dismissing a suggestion does not save it or ask again for the identical snippet in the same session.
- Priority: Must · Tier: Core

#### US-MEM-04 — Edit and delete a memory
*As a user, I want to edit or delete an existing memory, so that I can keep my notebook accurate.*
- AC: editing creates a new version (see `US-MEM-08`) rather than overwriting silently; deleting requires a confirmation step and removes the memory from all future retrieval immediately.
- Priority: Must · Tier: Core

#### US-MEM-05 — Image memories
*As a user, I want to save an image as a memory, so that visual information can be part of my context too.*
- AC: supported formats (PNG/JPEG at minimum) upload and display as a thumbnail; image memories appear in search/retrieval results alongside text memories.
- Priority: Should · Tier: Core

#### US-MEM-06 — Duplicate detection and merge
*As a user, I want the system to flag near-duplicate memories and let me merge them, so that my notebook doesn't accumulate redundant entries.*
- **Given** two memories with high semantic similarity above the duplicate threshold, **when** the second one is saved, **then** a duplicate suggestion is created linking both, without blocking the save.
- **Given** a pending duplicate suggestion, **when** the user chooses "merge," **then** the two memories combine into one record and both originals' version histories are preserved under the merged memory.
- **Given** a pending duplicate suggestion, **when** the user chooses "dismiss," **then** both memories remain separate and the same pair is not flagged again.
- Priority: Should · Tier: Core

#### US-MEM-07 — Stale memory detection and review
*As a user, I want to be told when a memory looks outdated based on newer information, so that my notebook doesn't quietly go wrong.*
- **Given** a new memory that contradicts an existing one (e.g. a changed city, changed tech stack), **when** it's saved, **then** the older memory is flagged as a stale suggestion, not silently overwritten.
- **Given** a pending stale suggestion, **when** the user approves it, **then** the old memory is marked inactive (not hard-deleted) and excluded from future retrieval.
- **Given** a pending stale suggestion, **when** the user dismisses it, **then** the old memory stays active exactly as before.
- Priority: Should · Tier: Core

#### US-MEM-08 — Memory version history
*As a user, I want to see how a memory has changed over time, so that I can understand or undo an edit.*
- AC: every edit produces a new version with a timestamp and, where available, who made the change; a user can view a prior version's content without it becoming the active version automatically.
- Priority: Should · Tier: Core

#### US-MEM-09 — Unlimited memory, scalable browsing
*As a heavy user with hundreds of memories, I want the list to stay fast and searchable, so that scale doesn't degrade usability.*
- AC: list view remains responsive (virtualized/paginated) past 1,000 memories; search/filter returns results without a full-page reload.
- Priority: Should · Tier: Core

---

### 7.3 Organization (Buckets & Sharing) — `Phase FE-3 / BE-3`

#### US-ORG-01 — Create, rename, and delete buckets
*As a user, I want to organize memories into named buckets, so that unrelated context (personal vs. client work) doesn't mix.*
- AC: a bucket can be created with just a name; renaming doesn't affect its contents or sharing state; deleting a bucket asks what happens to its memories (move to default vs. delete) rather than silently doing one or the other.
- Priority: Must · Tier: Core

#### US-ORG-02 — Assign and move memories/files between buckets
*As a user, I want to move a memory or file into a different bucket, so that my organization can evolve.*
- AC: an item can belong to exactly one bucket at a time (no silent duplication across buckets); moving is reflected everywhere the item appears (Memory list, Files, Ask) without a refresh.
- Priority: Should · Tier: Core

#### US-ORG-03 — Bucket-based filtering everywhere
*As a user, I want to filter by bucket in every section of the app, so that I can focus on one context at a time.*
- AC: the same bucket filter component/behavior is used in Memory, Files, and Ask — not three different filtering implementations; filtering by a bucket the user has no access to is not possible (not just hidden in the UI).
- Priority: Must · Tier: Core

#### US-ORG-04 — Shared buckets, invitations, and roles
*As a team lead, I want to invite a teammate to a bucket with a specific role, so that we can share client context without sharing everything.*
- **Given** an owner invites a teammate by email with the editor role, **when** the invite is sent, **then** a pending membership is created and an invite notification/email goes out — the teammate has no access yet.
- **Given** a pending invite, **when** the invited user accepts, **then** their membership becomes active and they immediately see the bucket's memories according to their role.
- **Given** a member with the viewer role, **when** they attempt to edit or delete a memory in that bucket, **then** the action is rejected server-side (not just hidden in the UI) with a clear permission error.
- **Given** a member with the editor role, **when** they edit a memory, **then** the change is visible to the owner and all other members immediately, and is attributed to that member in version history.
- **Given** an owner removes a member, **when** the removal completes, **then** that member loses access to the bucket on their very next request — no residual access window.
- Priority: Must · Tier: Pro

---

### 7.4 Chat History Archive — `Phase FE-5 / BE-5`

#### US-ARC-01 — Import conversations from a supported platform
*As a user, I want to import my past conversations from ChatGPT, Claude, Gemini, TypingMind, Grok, or DeepSeek, so that old context isn't lost.*
- AC: import wizard clearly states which platforms are supported and how (export-file upload vs. connected account); import progress is visible; a failed import for one platform doesn't corrupt already-imported data from another.
- Priority: Must · Tier: Core (last 500) / Pro (unlimited)

#### US-ARC-02 — Automatic, idempotent sync
*As a user, I want to keep syncing new conversations over time without creating duplicates, so that re-running a sync is always safe.*
- **Given** a conversation that was already imported, **when** the same sync job runs again, **then** no duplicate `Conversation` or `Message` rows are created — the existing record is left as-is or updated in place.
- **Given** a sync in progress, **when** the user cancels it, **then** partially-synced conversations remain usable (not left in a broken half-state) and the sync can resume later without re-processing completed items.
- **Given** a sync job that fails partway through, **when** it retries, **then** it resumes rather than restarting from zero.
- Priority: Must · Tier: Core

#### US-ARC-03 — Semantic search over chat history
*As a user, I want to search my history by meaning, not just exact words, so that I can find "what did I decide about the database migration" even if I never used that phrase.*
- AC: a query with no exact keyword overlap can still surface a relevant conversation ranked above unrelated ones; results show enough preview text to judge relevance without opening the full transcript.
- Priority: Must · Tier: Core

#### US-ARC-04 — Full transcript viewer
*As a user, I want to read a complete past conversation, so that I have the full context behind a summary or search result.*
- AC: transcript renders with clear turn-by-turn attribution (user vs. AI); very long transcripts load progressively rather than freezing the page.
- Priority: Should · Tier: Core

#### US-ARC-05 — Conversation summaries (Pro)
*As a Pro user, I want a short summary of a long conversation, so that I don't have to re-read it to remember what happened.*
- AC: summary generation happens asynchronously after import/sync, not blocking the import itself; summary is visible in the archive list without opening the transcript.
- Priority: Should · Tier: Pro

#### US-ARC-06 — Monthly insights (Pro)
*As a Pro user, I want a periodic digest of patterns across my conversations, so that I get value beyond just search.*
- AC: digest is generated on a schedule (not on-demand only) and covers the prior calendar month; a user with too little activity in a month sees an honest "not enough data" state rather than a fabricated digest.
- Priority: Could · Tier: Pro

#### US-ARC-07 — High-accuracy recall
*As a user asking a precision-sensitive question, I want a more careful recall pass, so that the top result is actually the right one, not just semantically close.*
- AC: this path re-ranks the top candidates (not just raw vector similarity) before returning results; it is clearly distinguished from ordinary search in behavior even if not in UI labeling.
- Priority: Could · Tier: Pro (preview may be available on Core)

#### US-ARC-08 — Plan-based history limits
*As a Core user, I want to know when I'm approaching the last-500-conversation limit, so that I'm not surprised by older conversations disappearing.*
- AC: the limit is enforced server-side, not just suggested in the UI; approaching the limit shows an upgrade prompt rather than silently dropping data without notice.
- Priority: Should · Tier: Core

---

### 7.5 Files & Knowledge Base — `Phase FE-6 / BE-6`

#### US-FIL-01 — Upload a file and track processing
*As a user, I want to upload a PDF, Word, Markdown, or text file and see when it's ready to query, so that I know when I can trust the answer.*
- AC: unsupported file types are rejected with a clear message before upload completes; status moves visibly from processing → ready (or → error with a reason).
- Priority: Must · Tier: Core

#### US-FIL-02 — File buckets
*As a user, I want to organize files into the same buckets as my memories, so that a client's documents and a client's memories live together.*
- AC: file bucket assignment uses the same bucket component/behavior as `US-ORG-01`–`03`, not a separate system.
- Priority: Should · Tier: Core

#### US-FIL-03 — File Q&A with page/section citations
*As a user, I want to ask a question against an uploaded document and get an answer with a citation I can verify, so that I trust the answer enough to act on it.*
- **Given** a processed file and a question about its content, **when** the user asks, **then** the answer includes at least one citation identifying the page or section it came from.
- **Given** an answer with a citation, **when** the user clicks it, **then** they're taken to (or shown) the exact source passage — not just the file's first page.
- **Given** a question with no relevant content in the file, **when** the user asks, **then** the system says so rather than fabricating an answer.
- Priority: Must · Tier: Core

#### US-FIL-04 — File search
*As a user, I want to search across the text of my uploaded files, so that I can find a document by its content, not just its filename.*
- AC: search matches on extracted content, not filename alone; results indicate which file and roughly where the match occurred.
- Priority: Should · Tier: Core

---

### 7.6 Ask (Unified Query) — `Phase FE-7 / BE-7`

#### US-ASK-01 — Ask a question across Memories, Chat History, and Files
*As a user, I want to ask one question and get an answer that draws on whichever of my memories, past chats, and files are relevant, so that I don't have to search three places manually.*
- **Given** a question with relevant information split across a memory and a past conversation, **when** the user asks in "All" mode, **then** the answer synthesizes both, and both are listed as sources.
- **Given** an answer with multiple sources, **when** the user inspects it, **then** each source is individually attributable — the answer must not blend sources without indicating which claim came from where.
- **Given** no relevant information exists in any of the three stores, **when** the user asks, **then** the system says it doesn't have relevant context rather than answering from general knowledge as if it were the user's own data.
- Priority: Must · Tier: Core

#### US-ASK-02 — Mode selection
*As a user, I want to scope my question to just Memories, just Chat History, just Files, or All, so that I can narrow the search when I already know where the answer lives.*
- AC: switching modes on an existing question re-runs retrieval under the new scope rather than just re-filtering stale results.
- Priority: Should · Tier: Core

#### US-ASK-03 — Source references
*As a user, I want every Ask answer to show clickable sources, so that I can verify before I trust it.*
- AC: every non-trivial claim in an Ask answer is traceable to at least one shown source; there is no answer state with zero sources shown when sources were actually used.
- Priority: Must · Tier: Core

#### US-ASK-04 — Saved Ask conversations
*As a user, I want my Ask threads to be saved and resumable, so that I can pick up a line of questioning later.*
- AC: a saved thread preserves prior questions, answers, and their sources; resuming a thread lets the user ask a follow-up with that context intact.
- Priority: Should · Tier: Core

#### US-ASK-05 — Bucket-scoped Ask
*As a team lead, I want to scope an Ask question to one bucket, so that I don't get a client's context bleeding into an unrelated question.*
- AC: scoping to a bucket the user doesn't have access to is not possible; scoping behaves identically to bucket filtering elsewhere in the app (`US-ORG-03`).
- Priority: Should · Tier: Core

#### US-ASK-06 — Copy response
*As a user, I want to copy an Ask answer, so that I can paste it elsewhere.*
- AC: copy includes the answer text; citations are either included or clearly excluded by a documented, consistent behavior.
- Priority: Could · Tier: Core

---

### 7.7 Cross-AI Integrations — `Phase FE-8 / BE-8`

#### US-INT-01 — Browser extension install and onboarding
*As a new user, I want a short walkthrough after installing the extension, so that I understand what it does before I rely on it.*
- AC: walkthrough covers activation, saving a memory, and syncing chat history; it can be replayed later from settings.
- Priority: Must · Tier: Core

#### US-INT-02 — Quick Inject
*As a user in a supported AI tool, I want to inject a bucket's context in one or two clicks, so that the AI has my context without me retyping it.*
- AC: injected content matches what the "context preview" would show for that bucket at that moment (see `US-ADV-01`); injection completes without navigating away from the AI's chat page.
- Priority: Must · Tier: Core

#### US-INT-03 — MCP connection (hosted and local)
*As a builder using Claude Code, Cursor, or another MCP client, I want to connect via MCP, so that my agent can search and save memory directly.*
- **Given** a valid MCP token, **when** an MCP client calls the memory-search tool, **then** results respect the same bucket-permission rules as the dashboard — no bypass via MCP.
- **Given** an MCP client calls the save tool, **when** the save succeeds, **then** the new memory is immediately visible in the dashboard and to other integrations, not just to that MCP session.
- **Given** an invalid or revoked MCP token, **when** any tool call is made, **then** it fails clearly rather than silently returning empty results.
- Priority: Must · Tier: Core

#### US-INT-04 — Custom GPT setup
*As a ChatGPT user, I want to connect a Custom GPT to my context, so that ChatGPT can recall my memory without the extension.*
- AC: the Custom GPT can search/recall but cannot perform destructive account actions (delete account, change billing) — a deliberately restricted action set.
- Priority: Should · Tier: Core

#### US-INT-05 — TypingMind plugin
*As a TypingMind user, I want a native plugin that reaches my memories, chat history, and files, so that I don't need the browser extension there.*
- AC: plugin functions map 1:1 to documented capabilities (no hidden extra scope); a disconnected plugin fails gracefully with a reconnect prompt.
- Priority: Could · Tier: Core

#### US-INT-06 — Open API and documentation
*As a builder, I want a documented public API, so that I can build my own tools on top of the platform.*
- AC: every endpoint used by the dashboard is either documented publicly or explicitly marked internal; API responses are versioned so a future breaking change doesn't silently break existing integrations.
- Priority: Should · Tier: Core

#### US-INT-07 — Desktop sync agent (macOS)
*As a Claude Code/Codex/Cursor user, I want a lightweight desktop agent that captures useful context from my coding sessions, so that terminal work feeds the same memory as my browser AI tools.*
- AC: agent pairing requires an explicit, visible authorization step (no silent background enrollment); the user can see what the agent has captured before it's finalized as a memory, consistent with `US-MEM-03`.
- Priority: Could · Tier: Core

#### US-INT-08 — Agent Skills install
*As a Claude Code/Codex/Cursor user, I want an installable skill package that teaches the agent to check memory before assuming and save memory before finishing, so that memory becomes part of the agent's normal workflow.*
- AC: skill install instructions are copy-pasteable; the skill's recall/save calls go through the same authenticated API as every other integration — no special unauthenticated path.
- Priority: Could · Tier: Core

---

### 7.8 Advanced Intelligence (Pro) — `Phase FE-9 / BE-9`

#### US-ADV-01 — Smart Memory context preview and token savings
*As a user, I want to see exactly what would be injected into my current conversation before it happens, so that I trust and understand what Smart Memory is doing.*
- **Given** Smart Mode is on and the user is in a live conversation, **when** they open the context preview, **then** it shows the exact memories/snippets that would be injected — not an approximation.
- **Given** a large memory set (100+), **when** Smart Memory assembles context, **then** the injected token count is measurably smaller than sending every memory, and the savings figure shown is accurate to what was actually sent.
- **Given** Smart Mode is off, **when** the user checks the preview, **then** it clearly reflects the un-filtered behavior rather than showing stale Smart Mode output.
- Priority: Should · Tier: Core (basic) / Pro (full category tuning)

#### US-ADV-02 — Knowledge graph explorer
*As a Pro user, I want to explore how my memories and conversations connect as a graph, so that I can see relationships I wouldn't have searched for directly.*
- AC: every edge in the graph is traceable back to a source memory or conversation (no unattributed relationships); graph remains navigable (not a frozen unreadable mass) at a few hundred nodes.
- Priority: Could · Tier: Pro

#### US-ADV-03 — Usage analytics dashboard
*As a Pro user, I want to see how I'm using the platform over time, so that I understand its value to me.*
- AC: metrics shown (memories created, tokens saved, Ask usage, sync volume) match what actually happened in the underlying event log — no estimated/placeholder numbers presented as exact.
- Priority: Could · Tier: Pro

---

### 7.9 Billing & Plans — `Phase FE-10 / BE-10`

#### US-BIL-01 — Pricing and plan comparison
*As a prospective or current user, I want a clear Core vs. Pro comparison, so that I can decide which plan fits.*
- AC: every feature gated in `Backend_Plan.md` §10 middleware appears correctly on the correct side of this comparison — the pricing page and the actual gating logic must never disagree.
- Priority: Must · Tier: Core

#### US-BIL-02 — Upgrade and downgrade
*As a user, I want to change plans through a standard checkout flow, so that switching is low-friction.*
- AC: upgrade takes effect immediately (Pro features unlock without a support ticket); downgrade is scheduled for period-end rather than instantly cutting off something the user already paid for.
- Priority: Must · Tier: Core

#### US-BIL-03 — Trial and refund policy enforcement
*As a new user, I want the advertised 7-day trial and 14-day refund window to actually be enforced consistently, so that the policy is trustworthy.*
- AC: trial-end and refund-eligibility dates are computed server-side from the actual signup/purchase timestamp, not editable client-side.
- Priority: Must · Tier: Core

#### US-BIL-04 — Feature gating for Pro-only capabilities
*As a Core user, I want to see what I'd get with Pro when I hit a limit, rather than a dead end.*
- AC: hitting a Pro-gated feature shows an upgrade path, not a silent failure or a generic error; the gate is enforced server-side (`Backend_Plan.md` §10), so it cannot be bypassed by calling the API directly.
- Priority: Should · Tier: Core

---

### 7.10 Security, Privacy & Compliance — `Phase FE-11 / BE-11`

#### US-SEC-01 — Encryption in transit and at rest
*As a user, I want my data encrypted both in transit and at rest, so that a network intercept or a storage breach doesn't expose it in plain text.*
- **Given** any client-to-server call, **when** it's made, **then** it happens over TLS with no plaintext fallback path.
- **Given** data stored in Postgres or object storage, **when** it's at rest, **then** it is encrypted at the infrastructure level, verified in deployment config — not merely asserted in a privacy page.
- Priority: Must · Tier: Core

#### US-SEC-02 — No training on user data, no data sale
*As a user, I want a technical guarantee — not just a policy statement — that my content is never used to train a model or sold to a third party.*
- **Given** any user content flowing through the LLM provider abstraction (capture, categorization, summarization, Ask synthesis), **when** the call is made, **then** it uses a provider configuration that opts out of training use, verified against the provider's documented data-use terms.
- **Given** any analytics or third-party pipeline, **when** user content could flow through it, **then** raw content is excluded — only anonymized/aggregated metrics leave that boundary.
- Priority: Must · Tier: Core

#### US-SEC-03 — Data export completion and tracking
*As a user, I want confidence that an export request actually ran to completion, so that "export my data" isn't a black box.*
- AC: an export job's status (queued/running/complete/failed) is visible to the user; a failed export retries or clearly tells the user to retry, rather than failing silently.
- Priority: Must · Tier: Core

#### US-SEC-04 — Permanent deletion cascade
*As a user who deletes my account (`US-ACC-06`), I want every trace of my data actually removed, so that deletion means deletion.*
- **Given** a confirmed account deletion, **when** the deletion job runs, **then** it removes the user's rows from Postgres, their vectors from the vector index, and their objects from S3-compatible storage — all three, not just the database rows.
- **Given** a completed deletion, **when** anyone (including staff tooling) queries for that user's content afterward, **then** nothing is returned.
- **Given** a deletion request, **when** it completes, **then** an audit log entry records that it happened, without retaining the deleted content itself.
- Priority: Must · Tier: Core

#### US-SEC-05 — Audit log for compliance requests
*As the platform operator, I want export and deletion requests logged to completion, so that a future regulatory request (GDPR/CCPA-style) can be answered with evidence.*
- AC: every export/deletion request has a start time, completion time, and outcome recorded; the log itself does not contain the exported/deleted content, only metadata about the action.
- Priority: Should · Tier: Core

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Dashboard time-to-interactive < 2.5s on mid-tier hardware; Ask/retrieval p95 latency budget set and load-tested before launch (`Backend_Plan.md` Phase 12) |
| Availability | Sync and embedding jobs retry with backoff; a platform-connector failure (one AI tool's import breaking) must not degrade other platforms |
| Scalability | Vector search scaling path (pgvector → dedicated vector DB) decided before Phase 5/6 data volume grows, not after |
| Accessibility | WCAG 2.1 AA on all core flows (`Frontend_Plan.md` Phase 12 gate) |
| Security | See `US-SEC-01`–`05` and `Backend_Plan.md` §11 |
| Compliance | Export/deletion requests traceable end-to-end via audit log for any future regulatory request |
| Observability | Every async job (embedding, sync, summarization, knowledge-graph extraction) has status, retry policy, and dead-letter handling |
| Type safety | End-to-end via TypeScript on both sides, Prisma-generated types on the backend, Zod schemas shared between frontend forms and backend validation |

## 9. Cross-Reference Index (Epic → Phase)

| Epic | Frontend Phase | Backend Phase |
|---|---|---|
| Account & Access | FE-1 | BE-1 |
| Memory | FE-2 | BE-2 |
| Organization (Buckets) | FE-3 | BE-3 |
| Smart Memory (underlies Advanced Intelligence) | FE-4 | BE-4 |
| Chat History Archive | FE-5 | BE-5 |
| Files & Knowledge Base | FE-6 | BE-6 |
| Ask | FE-7 | BE-7 |
| Cross-AI Integrations | FE-8 | BE-8 |
| Advanced Intelligence (Pro) | FE-9 | BE-9 |
| Billing & Plans | FE-10 | BE-10 |
| Security, Privacy & Compliance | FE-11 | BE-11 |
| QA, Performance & Launch | FE-12 | BE-12 |

## 10. Open Questions & Risks

- **Duplicate/stale thresholds** (`US-MEM-06`, `US-MEM-07`): the exact similarity threshold and
  contradiction heuristic need a concrete first value plus a way to tune it post-launch based on false
  positive/negative rates — not fully specified yet.
- **MCP protocol versioning** (`US-INT-03`): MCP itself is an evolving spec; the integration needs a
  compatibility policy for when the protocol version changes.
- **"No training on user data" verification** (`US-SEC-02`): this needs a compliance/legal review of
  the actual LLM provider's terms before the claim goes on a pricing or privacy page, not just an
  engineering configuration flag.
- **Knowledge graph scale** (`US-ADV-02`): rendering strategy (canvas/WebGL vs. SVG) for large graphs
  is undecided — flagged in `Frontend_Plan.md` §8.
- **Platform-connector fragility** (`US-ARC-01`): each of the six import sources depends on that
  platform's export format or API staying stable; needs a versioned-parser pattern so one breaking
  doesn't block the rest.

## 11. Document Control

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Draft — pending stakeholder review |
| Last updated | 2026-08-08 |
| Related documents | `Frontend_Plan.md`, `Backend_Plan.md` |
