# MemoryPlugin — Full Architecture & Clone Build Spec

*Compiled from a full crawl of help.memoryplugin.com (getting-started, integrations, features, API reference, platforms, FAQ), the public OpenAPI spec at memoryplugin.com/openapi.json, and MemoryPlugin's own engineering wiki ("The Field Guide to AI Memory" at memoryplugin.com/wiki), current as of Aug 2026.*

---

## 1. Product concept in one paragraph

MemoryPlugin is a **cross-platform, user-owned memory layer** that sits outside every AI chat app and feeds context into whichever one you're using. It solves one problem: every AI chat starts from a blank context window, so users re-explain themselves constantly, and whatever an AI *does* remember (ChatGPT's memory, Claude's memory) is locked inside that one app. MemoryPlugin's bet: memory should belong to the user, not the app, and it should travel between apps. It has two content layers (a curated fact store and a searchable chat-history archive) and reaches every AI tool through whichever connection method that tool supports — a real tool call (MCP / Actions) where possible, and browser-injected prompt text where not.

---

## 2. High-level architecture

```
                         ┌─────────────────────────────────────────┐
                         │              ONE MEMORY STORE            │
                         │                                           │
   NOTEBOOK LAYER        │  Buckets → Memories (versioned, text/img) │
   (explicit, editable   │  Smart Memory (per-bucket categories)     │
    facts)                │  Suggestions curator (dedup/merge/update)│
                         │  Knowledge Graph (beta, per-bucket)       │
                         │                                           │
   ARCHIVE LAYER         │  Imported/synced conversations            │
   (chat history,        │  Chunked + embedded + indexed             │
    searched not          │  Recall pipeline (hybrid search + AI     │
    distilled)             │  synthesis, on demand)                   │
                         └─────────────────────────────────────────┘
                                        │
                     ┌──────────────────┼──────────────────┐
                     │                  │                  │
              TOOL-CALL PATH      INJECTION PATH      DIRECT API PATH
        (MCP / GPT Actions /   (browser extension,   (REST + OpenAPI,
         TypingMind plugin)     marker-line protocol)  n8n/Zapier/custom)
                     │                  │                  │
              Claude, Cursor,    ChatGPT, Claude.ai,   Any app, workflow,
              Claude Code,        Gemini, Grok,         or automation
              Windsurf, VS Code   DeepSeek, Perplexity,
              Copilot, 100+ MCP   Mistral, Poe, Qwen,
              clients             LibreChat, 21+ sites
```

Two structural rules run through the whole system:
1. **No silent writes.** The AI can *propose* a memory or a cleanup, but a human (or an explicit, intentional tool call) has to be the one that commits it. This is a deliberate product stance, not just a UI nicety — it's the dividing line between "curated memory" and "an LLM quietly rewriting your profile."
2. **Prefer a real tool call; fall back to text injection only when no tool call is available.** A default chat on ChatGPT/Claude/Gemini's web UI has *zero* third-party tools connected unless the user explicitly wired one up — so injection into the prompt is the only path guaranteed to work everywhere, even though it's structurally the least-trusted channel.

---

## 3. Data model

### 3.1 Memory
| Field | Notes |
|---|---|
| `id` | Encoded/opaque memory ID |
| `text` | The fact itself. Convention: prepend the current date (`YYYY-MM-DD`) in the user's timezone if known, else UTC |
| `bucketId` / `bucketName` | A memory lives in exactly one bucket |
| `content_type` | `"text"` or `"image"` |
| `image_url` | Signed URL, **expires in 4 hours** (image memories only) |
| `image_description` | AI-generated caption used for text-based recall of an image (does not expire) |
| `version` | Increments on every text/bucket edit |
| `createdAt` / `updatedAt` | ISO 8601 |
| `score` | Relevance score, present on search results |
| author/attribution | In shared buckets: "added by You" / "added by {owner}" / "added by a collaborator" |

**Versioning is append-only.** Editing a memory's text re-embeds it and creates a new version; nothing is destructively overwritten. Deleting or merging a memory during curation leaves a soft-delete trail (`merged_into` pointer to the survivor) while hard-deleting only the vector — the relational record of *what happened to a fact* outlives its embedding. This is what makes edit history, audit, and "why did this change" answerable.

### 3.2 Bucket
| Field | Notes |
|---|---|
| `id`, `name`, `description`, `memoryCount` | Core fields |
| Type | `Memory` bucket (text snippets) or `File` bucket (documents) |
| `General` | Every account gets one, undeletable, unshareable, can't be renamed away from "General" |
| Naming rule | Unique case-insensitively; cannot be digits-only |
| Sharing | Memory buckets only (not File buckets). Roles: **Viewer** (read/use only), **Contributor** (add + edit/delete own only — default role), **Editor** (edit/delete anyone's). Only the **owner** can rename/delete/manage access/re-run Smart Memory |
| Limits | No cap on number of buckets. Smart Memory needs ≥30 memories to activate, and won't process a bucket over 600,000 tokens or 2,000 memories |

### 3.3 Conversation (Chat History)
| Field | Notes |
|---|---|
| `id`, `title`, `platform`, `messageCount`, `tokenCount` | List/summary fields |
| `messages[]` | Each: `id`, `role` (`human`/`assistant`), `content`, `createdAt` |
| Pinning | Pinned chats can't be bulk-deleted |
| Excluding | Deletes content + vectors permanently but keeps a metadata placeholder; frees quota; chat will never be re-imported/re-synced |
| Deleting | Removes chat entirely; backups purge in 30 days; **can reappear** on a future import/sync (unlike exclude) |
| Import quota | Core: 500 searchable chats, one platform. Pro: unlimited, all platforms |

---

## 4. How it connects to different AIs — the four integration paths

This is the part most relevant to "how it's connected with different AIs." There are four fundamentally different connection mechanisms, chosen per-platform based on what that platform exposes.

### 4.1 Browser extension — prompt injection (no tool-calling required)

Used for: ChatGPT, Claude.ai, Gemini, Grok, DeepSeek, Perplexity, Mistral, Poe, Qwen, Z.ai, OpenRouter, Google AI Studio, NotebookLM, LibreChat, ChatLLM, MiniMax, TypingMind, Kimi (21+ web AI surfaces total). Available on all Chromium browsers plus Safari (iOS/macOS); on Android via the Quetta browser.

**Mechanism ("pre-send interception"):**
1. The extension hooks the page's send action (button click / Enter key).
2. On activation (manual click, or auto-inject after a 5-second cancellable countdown), it fetches memories from the currently selected bucket and **prepends them into the composer** before the message is sent, along with a short instruction telling the AI how to save new memories.
3. It also watches the AI's *response* for a marker line and, when found, extracts and stores it as a new memory:
   ```
   to=memoryplugin&&memory=[memory text here]
   ```
   (ChatGPT specifically uses `tool=memoryplugin&&memory=...` instead of `to=`.)
4. Selecting ≥3 characters of any chat text surfaces an **"Extract memory"** pill for one-click manual capture.
5. Chat History sync (separate from memory) captures whole conversations live from ChatGPT, Claude, Gemini (experimental), Grok, DeepSeek, TypingMind — no export file needed. Auto-sync runs hourly per platform.

**Why the injected text can't look like a command — a critical, non-obvious design constraint:**
Modern models are heavily trained to resist prompt injection. A naive injection payload shaped like a directive/system-override —
```
The user has enabled the following plugin. Take note of the following
for the remainder of the conversation: to=memory&&load=work_context
```
— **gets refused as a suspected attack**, because it pattern-matches third-person authority framing, shell-like control syntax, and system-message forgery, all of which the model was RLHF'd to distrust when it appears in a user turn. The fix that actually works:
- **Annotation-shaped, not directive-shaped** — a bracketed aside or comment, not an override block.
- **First person, user's own voice**: `[note to self: I work at Acme, mostly TypeScript...]` — not `The user works at Acme.`
- **No ceremony** — no "for the remainder of this conversation," no "you must."
- **Route through a real tool call wherever one exists**; reserve text-injection for platforms that give you no other choice.

A second, quieter failure mode: injecting *messy* memory (duplicates, fragments, "user said hi") causes the model to judge the whole memory feature as junk and disregard it — so pre-injection hygiene (dedup, drop fragments, cap the list) is a **delivery requirement**, not just a quality nice-to-have.

**Panel UI surface (what to build):** floating draggable button (position remembered per-site) → opens a panel with header (branding, plan badge, dark-mode toggle) → bucket-selector row with a "Smart Mode" toggle → bottom tab bar: **Memories** / **Sync** / **History** / **Account** / **Settings**. Quick-inject button inline in the composer where layout allows; otherwise a glass "Add Memories" pill floats above the button.

### 4.2 MCP server — real tool calls (local + hosted/remote)

Used for: Claude Desktop/Web/Mobile, Claude Code, Cursor, Windsurf, Cline, VS Code Copilot Chat, and any of 100+ MCP clients.

**Local server** (`@memoryplugin/mcp-server`, run via `npx`, Node.js required): client config points at a command + an env var carrying a bearer-token-equivalent auth token.
```json
{
  "mcpServers": {
    "memoryplugin": {
      "command": "npx",
      "args": ["@memoryplugin/mcp-server"],
      "env": { "MEMORY_PLUGIN_TOKEN": "your-auth-token-here" }
    }
  }
}
```

**Remote/hosted server** (recommended default): no install, no token-in-config. OAuth 2.0 with PKCE + Dynamic Client Registration (DCR) — most modern MCP clients self-register on first connect and the user just approves access in a browser popup.
- Base URL (auto-discovery): `https://www.memoryplugin.com`
- HTTP (streamable): `https://www.memoryplugin.com/api/mcp/mcp`
- SSE: `https://www.memoryplugin.com/api/mcp/sse`
- For clients with no native remote-MCP support: a local `mcp-remote` proxy process forwards to the SSE endpoint so it looks local to the client.

**Tool surface exposed over MCP** (13 tools total, shared identically by local and remote):

| Category | Tool | Purpose |
|---|---|---|
| Memory | `store_memory` | Save a new memory (AI is prompted to do this proactively) |
| Memory | `get_memories_and_buckets` | Load memories (optionally filtered by bucket) + bucket list |
| Memory | `search_memories` | Semantic search, ranked by relevance |
| Memory | `list_buckets` | List buckets |
| Memory | `create_bucket` | Create a bucket |
| Memory | `update_or_move_memories` | Edit text and/or move 1–100 memories between buckets |
| Smart Memory | `list_bucket_categories` | Categories + summaries for a Smart-Memory-enabled bucket |
| Smart Memory | `list_category_memories` | Full memories within one category |
| Chat History | `recall_chat_history` | Search + AI-synthesize context from past conversations, parallel queries supported |
| Chat History | `get_conversation_summary` | Full transcript (short chats) or AI summary (long chats) |
| Chat History | `get_full_conversation` | Complete transcript of one past conversation |
| Chat History | `export_conversation` | Temporary (15-min) download link for a conversation as JSON |
| Files | `search_uploaded_files` | Search file-bucket documents, returns passages + file/page info |

Whether the model calls these tools each turn is entirely up to the model's own judgment — the docs are explicit that if it "forgets," the user has to nudge it via instructions.

### 4.3 Custom GPT / GPT Actions (ChatGPT-specific tool-calling path)

Two flavors:
- **Official ready-made Custom GPT** — zero setup, loads memories automatically at chat start, works on ChatGPT web/desktop/mobile, but is restricted to whichever models OpenAI currently allows Custom GPTs to run on (GPT-4o / GPT-5 Auto as of mid-2026 — a moving target OpenAI changes without notice).
- **Build-your-own integration**: import the OpenAPI spec (`https://www.memoryplugin.com/openapi.json`) as a GPT **Action**, set Authentication → API Key → Bearer with the user's token, then paste a specific instruction block into the GPT's system instructions. That instruction block is a first-class engineering artifact — it encodes bucket semantics, ID-hallucination guardrails, and a `\m` / `+m` quick-save shortcut:
```text
VERY IMPORTANT: ALWAYS fetch all memories at the start of each chat before
responding (unless explicitly instructed otherwise)... Use the
`GetMemoriesAndBuckets` operation to do this.

- Memories are stored in "buckets"
- If you do not supply a bucket id when loading memories, all memories are loaded
- by default memories are added to the "General" bucket
- new buckets cannot be named "General"
- Do not guess bucket IDs, they are random
I can use \m or +m as a shortcut to create a new memory.
- Double-check the function schemas... adhere to any specified JSON schema strictly.
```
This is the clearest evidence in the whole doc set that **prompt-engineering the tool-use instructions is itself a first-class part of the integration**, not an afterthought.

### 4.4 TypingMind plugin

A native plugin exposing the same-shaped functions as MCP (`store_memory`, `search_memories`, `get_memories_and_buckets`, `list_buckets`, `create_bucket`, `list_bucket_categories`, `list_category_memories`, `recall_chat_history`, `get_conversation_summary`, `get_full_conversation`, `search_uploaded_files`) — configured with a pasted auth token rather than OAuth.

### 4.5 Desktop app (macOS) — local coding-agent chat sync

A separate menu-bar app (installer labeled "MemoryPlugin Sync") that:
- Watches `~/.claude/projects` (Claude Code), `~/.codex/sessions` (Codex, incl. archived), and `~/.cursor/projects` (Cursor agent transcripts) — **read-only, nothing else on disk**.
- Skips subagent/system-noise transcripts automatically.
- "Focused sync" by default: uploads prompts + each turn's *final* answer only — tool output, file contents, terminal commands, and model "thinking" never leave the machine, regardless of setting.
- Waits for a chat to go idle 15 minutes before syncing (badge: "Syncs when idle"); "Sync Now" bypasses the wait.
- Auth via OAuth-style "Sign in with MemoryPlugin" (credentials in macOS Keychain) or a manual API token as a fallback.
- Global `⌘⇧K` search across *every* synced AI conversation regardless of source tool, ranked, filterable by tool, with a recency-boost slider.
- Gating: **sync requires Pro plan**; browsing already-synced local chats is free on any plan.

### 4.6 Direct REST / OpenAPI

For anything not natively supported: n8n (community OpenAPI node), Zapier, Make, Power Automate, Postman/Insomnia, or fully custom code. Single Bearer-token auth (`Authorization: Bearer <token>`) against `https://www.memoryplugin.com`. Full endpoint list in §6.

### 4.7 Compatibility matrix (as documented)

| Platform | Recommended method | Reads chat history | Imports/syncs chat history |
|---|---|---|---|
| ChatGPT | Browser extension (alt: Custom GPT) | ✅ | ✅ file + online sync |
| Claude | Browser extension + Remote MCP (both, recommended together) | ✅ | ✅ file + online sync |
| Gemini | Browser extension | ✅ | ✅ online sync (experimental) |
| Grok | Browser extension | ✅ | ✅ file + online sync |
| DeepSeek | Browser extension | ✅ | ✅ online sync |
| Perplexity, AI Studio, Mistral, Poe, LibreChat, Qwen, OpenRouter, ChatLLM, Z.ai, Kimi | Browser extension | ✅ | ❌ (read-only context) |
| TypingMind | Browser extension (alt: native plugin, MCP) | ✅ | ✅ file + online sync |
| Cursor, Windsurf, Claude Code, Sage, other MCP clients | MCP server | ✅ | ❌ (desktop app covers Claude Code/Codex/Cursor specifically) |
| Anything else | OpenAPI / REST | ❌ | ❌ |

Recall best-experience note from the docs: Claude (Desktop/Web/Mobile) and Mistral AI are called out specifically as strongest at agentic tool use and at folding retrieved MCP context back into a natural answer.

---

## 5. Core subsystems

### 5.1 Smart Memory — hierarchical, load-on-demand recall

Problem: flat bucket recall means injecting *everything* on every message, which burns tokens and buries the model in irrelevant memories as a bucket grows past a few hundred entries.

Mechanism:
1. **Categorize** — an LLM reads all memories in one bucket and groups them into a handful of named categories (optionally seeded with 2–10 user-defined category names before the first run).
2. **Summarize** — each category gets a short summary plus an "Additional Info" field written specifically to help an AI decide *when* to expand that category (this field matters more than the summary for recall quality).
3. **Load on demand** — at chat time, only category *summaries* are in context; the AI expands one full category only when the conversation turns to that topic, via a marker command: `<memoryplugin command="load_category" category="[id]" reason="[why]" />`.

Gating: needs ≥30 memories to activate; won't process >600,000 tokens or >2,000 memories in one bucket. Claimed savings: "~90% fewer tokens" on large buckets — mechanically true because summaries are far cheaper than full memory text, with exact savings depending on bucket size and how much of it any given conversation actually needs. Resetting categories is destructive and requires typing a confirmation phrase.

### 5.2 Memory Suggestions — the curator (human-in-the-loop cleanup)

A background/on-demand pass over one bucket that proposes exactly three kinds of edit, **never applies any of them automatically**:
- **Remove** — duplicate/redundant memory
- **Combine** — near-duplicate memories merged into one cleaner entry
- **Update** — a stale memory rewritten to be current

Mechanics worth replicating:
- Runs per-cluster: pulls each memory's nearest neighbors, hands the small cluster to a cheap/fast LLM (MemoryPlugin uses a Gemini Flash-class model), asks for one of the three moves.
- **Every model-returned ID is re-validated against the input set and re-checked for ownership before any write** — models will confidently invent IDs, and this check is the only thing standing between that and a corrupted store.
- Explicit, hard-won preservation rule: *"you are an editor, not a writer, lose zero information"* — with named categories that must never be dropped during a merge: dates, quantities, identifiers, current state, and the causal "why" behind a fact. This came from real incidents (a merge once discarded a usage statistic; another silently dropped a "since 2023" timestamp).
- Skips any memory over 10,000 tokens during analysis (too expensive to compare, unlikely to be a duplicate anyway).
- UI: a pending-count badge on the bucket; accept/reject one card at a time; a "Check for new" action to scan anything not yet covered.

### 5.3 Knowledge Graph (beta) — concept map, not a recall path

Per-bucket, generated on demand (can take up to 30 minutes for a large bucket), built as: extract entities → deterministically dedupe by name → LLM review/merge of variants → extract directed relationships, with a **stronger model reserved specifically for the final review step** (MemoryPlugin uses a Claude Sonnet-class model here) because nothing downstream catches its mistakes. Explicitly **not** wired into the recall pipeline — it's something a user *looks at*, not something that sharpens answers. A second store to keep in sync, which the docs are candid is a real cost with no automatic recall payoff.

### 5.4 Chat History — the "archive" layer (the technically deepest subsystem)

**Ingestion (write path, always async/background, never blocks anything):**
- **File import**: platform exports (ChatGPT `conversations.json`, possibly split into `-001`/`-002`/etc.; Claude ZIP, sometimes multi-part via a manifest of one-time-use download links; TypingMind `chunks/chats_part_N.json`) uploaded and parsed. Limits: ZIP ≤512MB, JSON ≤1GB, multiple files per import.
- **Online sync**: browser extension pulls directly from the platform's own account UI — no export needed. Six platforms supported (ChatGPT, Claude, Grok, DeepSeek, TypingMind, Gemini-experimental).
- **Programmatic upload** (`/api/chat-history/ingest/custom-online`): any external tool can push conversations in with **upsert semantics** — resending the same `conversation.id` updates rather than duplicates. Limits: 100,000 tokens/conversation, 50MB payload.
- Every path converges on the same pipeline: **chunk (~256 tokens, light overlap) → embed → index**. One deliberate rule: role and timestamp are stored as structured metadata fields and stripped out of the *embedded* text — baking them into the embedded string just adds noise without adding signal.
- Duplicate-safe: re-uploading/re-syncing the same conversation never creates duplicates.

**Recall (read path) — six-stage pipeline, run fresh on every query, no cached answers:**
1. **Query expansion** — an LLM rewrites the query into a few variants biased toward *what the user probably said back then* (first-person statement form), not toward search-engine phrasing of the answer, plus extracts any implied date filter. The verbatim original query is always re-added so rare proper nouns/identifiers aren't washed out by paraphrasing.
2. **Hybrid search** — each variant runs both a dense (vector/HNSW, cosine) search and a BM25 keyword search; the two ranked lists are fused with **Reciprocal Rank Fusion (RRF)**, not a weighted sum of raw scores (see §7.3 — this is the single most consequential implementation detail in the whole system).
3. **Rerank** — a cross-encoder reranker (MemoryPlugin uses a Voyage `rerank-2.5-lite`-class model) reorders the fused candidate pool against true query intent.
4. **Per-chunk relevance assessment** — an LLM reads each surviving candidate and decides if it *actually* answers the query (not just "looks similar"), dropping the ones that don't. **This step dominates total latency** (low single-digit seconds vs. sub-second for everything else combined) and is the one place a "speed" vs. "quality" tradeoff knob matters most.
5. **Context expansion** — pull neighboring messages around each surviving hit so the model gets the exchange, not an isolated sentence.
6. **Budgeted summarization** — fold survivors into an AI-written summary within a token budget (default ~600, hard cap 2,000 for the injection endpoint; default ~2,000 for the raw synthesis endpoint), with source citations (conversation ID/title, message ID, date, relevance score) attached.

Key design choice: **summarize at read time, shaped by the actual query — not ahead of time.** A pre-written digest of a conversation keeps whatever seemed generically important and silently drops whatever a *specific later question* actually needs. Read-time summarization costs more per-query but never loses the detail a user turns out to want. For conversations too large for one summarization pass (up to ~1M tokens), a progressive map-reduce fold is used: summarize a chunk, carry the running summary into the next chunk, repeat — keeping the working set roughly one-chunk-sized throughout, with cheap models doing the folding and spend reserved for the final synthesis pass.

Speed numbers worth designing against: ~2 seconds end-to-end is the target for a usable "remember this while I chat" recall (vs. ~30 seconds acceptable for a "research this whole book" batch tool) — nearly the entire gap is closed by parallelizing/lightening step 4, not by touching embeddings or search.

Delivery mechanism differs by connection type:
- **Browser extension**: one retrieval round per message, via the same injected-marker technique as regular memory (separate toggle, separate system from regular Memory).
- **Remote MCP**: a real tool call (`recall_chat_history`) supporting **up to 15 parallel queries** in one call (each hitting a different angle: timeline, people, decisions, outcomes), per-query `maxTokens` (300–1000 typical, 2000 hard cap), ISO date bounds (`before`/`after`), and a `speed` vs. `quality` mode toggle (quality = deeper grounding, slower, Pro-gated; Core silently runs in speed mode).

### 5.5 Ask — unified query surface

One dashboard tool, three mutually exclusive modes locked per-conversation: **History** (semantic search over imported chats), **Files** (search over uploaded documents), **Memories** (loads Smart-Memory-aware or flat bucket context). Every answer streams with clickable source citations back to the originals — the product's explicit position is that the synthesized answer is a *summary*, and the cited sources are ground truth. A "Think" toggle trades latency for an extended-reasoning pass on hard questions. Requires a paid plan; each mode additionally needs data present in that specific store.

### 5.6 File buckets — document RAG

Upload PDF/DOCX/DOC/MD/TXT (10MB cap, no scanned/image-only PDFs since only the text layer is read) → extract text → chunk → embed for semantic search. Queryable from Ask, MCP (`search_uploaded_files`), and TypingMind — **not yet wired into the browser extension or auto-injection** (explicitly flagged as still under development at time of writing). Answers cite file name + page.

### 5.7 Image memories

Upload an image → background job produces (a) a vector embedding in its own multimodal embedding space for cross-modal search (a text query can find a visually-relevant image) and (b) an AI-written text description used for text-based recall. API responses distinguish `content_type: "image"` and return a **4-hour signed URL** (re-fetch on expiry) plus the non-expiring description. PNG/JPEG/WebP/GIF, 10MB cap. Dashboard-only for now; not supported inside shared buckets.

---

## 6. Full API surface (for direct REST/API integration)

Base URL: `https://www.memoryplugin.com` · Auth: `Authorization: Bearer <token>` on every call · Errors: standard HTTP codes + `{"error": "..."}` body.

| Method | Path | Purpose | Key params/notes |
|---|---|---|---|
| POST | `/api/memory` | Create memory | `text` (required), `bucketId`, `source` |
| GET | `/api/memory` | Query/list memories (v1) | `query`, `all`, `latest`, `count`, `skip`, `source` |
| GET | `/api/v2/memory` | Get memories + buckets in one call | adds `bucketId` filter, `includeIds`, `contentType` (`text`\|`image`) |
| POST | `/api/v2/memory/update` | Edit text and/or move memory(ies) | single: `memoryId` + one of `text`/`bucketId`/`bucketName`; bulk: `memoryIds[]` (≤100) + `bucketId`/`bucketName` — bulk is move-only, all-or-nothing (404 + `rejectedIds` if any ID unresolved) |
| DELETE | `/api/memories/{memoryId}` | Delete one memory | removes from DB + vector store |
| POST | `/api/memories/bulk-delete` | Delete many memories | `memoryIds[]`; response reports `deleted`/`failed` counts |
| GET | `/api/buckets` | List buckets | — |
| POST | `/api/buckets` | Create bucket | `name` (required), `source` |
| POST | `/api/chat-history/inject` | **Recall**: hybrid search + AI-synthesized, cited summary | `query` or `queries[]` (≤15 parallel, each with own `maxTokens`), `maxTokens` (default 600, cap 2000), `platform` hint, `conversationContext`, `conversationHistory[]` |
| POST | `/api/chat-history/search` | **Raw search**: matched chunks + scores, no synthesis | `query`, `limit` (default 20, max 100), `provider`, `contextChunks` (default 4), `skipRerank` |
| POST | `/api/chat-history/ingest/custom-online` | Upload one conversation (upsert by `conversation.id`) | `platform`, `platformDisplayName`, `conversation.{id,title,createdAt,updatedAt,messages[]}` — 100k token/50MB caps, async `status: queued` response |
| GET | `/api/chat-history/chats` | List conversations, paginated/filtered | `page`, `pageSize` (max 100), `provider`, `title`, `dateFrom`/`dateTo`, `pinnedOnly`, `importId` |
| GET | `/api/chat-history/conversation` | Full transcript of one conversation | `conversationId` (required) |
| GET | `/api/chat-history/count` | Count of active imported conversations | excludes excluded/quota-blocked |
| DELETE | `/api/chat-history/chats` | Delete conversations | `ids[]`, irreversible |

Response-shape notes worth preserving in a clone:
- List/search endpoints mix plain strings and `{id, text, content_type, ...}` objects in the same array depending on flags (`includeIds`, image vs. text) — a pragmatic but slightly awkward `oneOf` union that a client has to branch on.
- `SuccessResponse` on create returns both `memoryId` and a `dbId` alias field for backwards compatibility — a signal that this API has already been through at least one versioning migration and kept the old field name alive rather than breaking clients.

---

## 7. Non-functional architecture — the parts that actually determine whether a clone works

These are the design principles pulled from MemoryPlugin's own engineering write-ups. They matter more than any single feature checkbox.

### 7.1 Two pipelines, one store, opposite priorities
A memory system is architecturally **a write path and a read path sharing a store and nothing else.** The read path is on the critical path of a chat response and needs a hard latency budget (precompute/cache/over-fetch-then-trim); the write path has no excuse to ever block a user-visible response — extraction, embedding, dedup, and indexing belong in a background queue, always. If a write step shows up in p95 read latency, it's on the wrong side of the fence.

### 7.2 No LLM-on-every-write
Running an extraction LLM on every single message is the most expensive design mistake in this space — one cited benchmark found memory systems running 14–77x more expensive and ~30% less accurate at fact recall than just passing full conversation history, root-caused specifically to background models re-normalizing facts on every turn. Reserve expensive LLM extraction for genuinely durable semantic facts; store working/execution state (tool output, logs, variables) losslessly with no LLM involved at all; and where possible (as MemoryPlugin does for chat history) skip write-time extraction entirely and synthesize only at read time, against the actual query.

### 7.3 Fuse ranked lists by rank, never by raw score
The single highest-value bug to avoid: combining a dense/cosine score (bounded ~0–1) and a BM25 score (unbounded, typically 5–30) with a weighted linear sum. At any weight, the larger raw scale dominates regardless of the intended split — a "70% semantic" config can end up functioning as an almost pure keyword engine. Use **Reciprocal Rank Fusion** instead: sum `1/(k + rank + 1)` per retriever per document (k≈60), which only ever looks at *position*, so scale mismatches between retrievers are structurally impossible. The same discipline applies when merging results from multiple query-expansion variants — dedupe by each document's *best* rank across variants, not by first-list-wins.

### 7.4 Fail open, never fail silent
Memory should be an enhancement, never a hard dependency — a memory-layer outage should degrade an answer, not break the chat. But "fail open" is not license to swallow errors: a saturated inference provider under high fan-out can return empty results that look identical to "no relevant memories found," which silently defeats the entire feature while reporting itself healthy. Concrete rule: distinguish "found nothing" from "the call failed" everywhere, surface the second case as an explicit retryable error, and only ever silently degrade the first.

### 7.5 Invalidate, don't delete; version, don't overwrite
Never let an LLM hard-delete a memory it might be wrong about. When a new fact contradicts an old one, either (a) mark the old fact's validity window closed rather than deleting it (so "what did I believe as of last Tuesday" stays answerable), or (b) chain versions (`parentId`/`rootId`/`isLatest`) so only the latest is served by default but history stays queryable. This is a **structure** problem, not a database-choice problem — a flat text blob can only ever be appended to; a typed record with identity can be updated in place. Distinguish "replaces" (a genuine contradiction) from "extends" (adds detail without invalidating anything) — collapsing both into a blind overwrite is how real information gets lost.

### 7.6 Write-time vs. read-time conflict resolution — pick deliberately
Two legitimate architectures: resolve contradictions at write time (diff every new fact against existing memory via an LLM call, keep the store single-truth and small) or at read time (append everything, unmodified, and let retrieval ranking surface the current fact from a pile of possibly-contradictory ones). The write-time approach is what most early memory products shipped; the more recent trend (explicitly documented as a deliberate reversal in at least one major open-source memory project) is toward read-time resolution because per-write LLM diffing measurably degrades both latency and accuracy compared to simple append-plus-good-ranking. Read-time only works if the ranker actually surfaces the current fact — which depends on temporal grounding at write time (anchor relative dates like "last week" to the actual conversation date) even if you don't resolve conflicts at write time.

### 7.7 Matching before merging: cheap filters first, LLM only for the ambiguous remainder
Don't calibrate a fixed cosine-similarity cutoff for "these two memories are duplicates" — similarity distributions are not portable across embedding models, and a threshold borrowed from someone else's blog post will misfire against your embedder. Layer it instead: exact string match (cheapest, catches verbatim dupes only, deliberately conservative — a missed near-duplicate is safer than a wrongly-merged distinct fact) → deterministic fuzzy matching for the obvious tier → LLM judgment only for the genuinely ambiguous remainder, with every LLM-returned ID re-validated against the actual input set and ownership before a single write executes.

### 7.8 Placement matters as much as ranking
Models read the start and end of a long context far better than the middle ("lost in the middle" effect). Winning the retrieval/rerank race is wasted if the winning memories get buried mid-prompt. Put the strongest memories at the edges of the injected block; keep the injected set small; resist the urge to dump every candidate in "just in case."

### 7.9 Privacy/security posture (explicit product stance, not incidental)
- Chat history ingestion is **strictly opt-in** at every step (import and sync both) — never captured by default.
- Encrypted in transit and at rest; no data sold to third parties; deletions processed immediately, backups purge after 30 days.
- Explicitly **not end-to-end encrypted**, and the docs are candid this is a deliberate tradeoff, not an oversight: server-side search, summarization, and cross-conversation synthesis are the entire value proposition, and real E2E encryption would kill all three. What's offered instead is transparency and control (export, delete, audit, per-item edit) rather than cryptographic secrecy.
- The system does **not** reliably resolve which of two contradicting historical facts is current — stated as an open field-wide problem, not something to fake a checkbox for.

---

## 8. Suggested technology stack (as implemented, for reference — swap freely)

| Layer | MemoryPlugin's choice | Why (as documented) |
|---|---|---|
| Relational store | Postgres | Memory rows, bucket metadata, conversation/message records, edit history |
| Vector store | Zilliz/Milvus | HNSW index, cosine distance, native BM25 support in the same collection |
| Embeddings | Voyage `voyage-3.5-lite`, truncated Matryoshka-style 1024→512 dims | Won on measured latency (~327ms/call) and consistency under load vs. a cheaper open alternative (~738ms/call); ~$0.02/M tokens, cheaper than Cohere's ~$0.12/M — a bonus, not the deciding factor |
| Keyword/lexical index | BM25, indexed alongside the dense vectors | Dense embeddings blur exact strings (error codes, IDs, proper nouns) that BM25 catches natively |
| Rank fusion | Reciprocal Rank Fusion (k≈60) | Scale-free; avoids the raw-score-mixing bug in §7.3 |
| Reranker | Voyage `rerank-2.5-lite`-class cross-encoder | Cheapest large accuracy win in the whole pipeline (per Anthropic's published Contextual Retrieval numbers: ~2.9%→1.9% top-20 failure rate) |
| Fast/cheap LLM steps (query expansion, per-chunk relevance, suggestions curator) | Groq-hosted open models / Gemini-Flash-class | Job is binary judgment ("does this chunk answer the question"), so inference speed buys more than marginal reasoning quality |
| High-trust final-review LLM step (knowledge graph merge review) | Claude-Sonnet-class | Reserved specifically for steps nothing downstream double-checks |
| MCP transport | Node.js local process (stdio) + hosted HTTP/SSE with OAuth2 PKCE + DCR | Two tiers matching user technical comfort |

---

## 9. Build checklist — what needs to exist, organized by dependency order

### Phase 1 — Core memory CRUD (foundation for everything else)
- [ ] Auth: bearer-token accounts, regenerable tokens, token scoped to account not to any third-party login email
- [ ] Bucket model: create/list/rename/delete, uniqueness+naming validation, undeletable default "General" bucket
- [ ] Memory model: create/get/update/delete, append-only versioning, soft-delete + `merged_into` trail on merge
- [ ] Basic REST API matching the shapes in §6, with an importable OpenAPI spec (unlocks GPT Actions, n8n, Zapier for free)
- [ ] Bulk operations: multi-select move/delete/export in the dashboard UI
- [ ] Import/export: CSV/JSON/plain-text both directions, paste-and-AI-split for unstructured notes

### Phase 2 — First integration surface
- [ ] MCP server (local, Node.js/stdio) exposing at minimum `store_memory`, `search_memories`, `get_memories_and_buckets`, `list_buckets`, `create_bucket`, `update_or_move_memories`
- [ ] Remote/hosted MCP server over HTTP+SSE with OAuth2 PKCE + Dynamic Client Registration — this is the higher-leverage build; local-only forces every user through Node.js setup
- [ ] Browser extension v1: floating button, single-platform injection (pick the highest-traffic target first), marker-line detection for AI-initiated saves, "Extract memory" text-selection pill
- [ ] **Injection-payload safety work is not optional** — test the exact prompt wording against real model refusal behavior before shipping; annotation-shaped/first-person framing per §4.1, not directive-shaped

### Phase 3 — Recall quality (this is where most of the real engineering effort goes)
- [ ] Hybrid retrieval: dense (HNSW/cosine) + BM25 in the same collection, fused by RRF (never raw-score-weighted-sum)
- [ ] Cross-encoder reranker as a second stage, fed ≥100+ candidates (not a handful) so it has something to actually promote
- [ ] Query expansion for chat-history recall specifically framed as "what would I have said back then," not "what answers this," with the literal original query always re-included
- [ ] Token-budgeted, cited summarization at read time (not pre-computed digests) — this is the single most differentiating design choice vs. plain RAG
- [ ] Fail-open behavior with explicit failure-vs-empty-result distinction throughout the recall path

### Phase 4 — Scale features (only worth building once buckets are large enough to need them)
- [ ] Smart Memory: per-bucket AI categorization + on-demand category expansion, gated at a real memory-count threshold
- [ ] Memory Suggestions curator: nearest-neighbor clustering → cheap-model proposal → mandatory ID re-validation → human accept/reject, never auto-applied
- [ ] Chat history: file-import parsers per platform export format + online sync via extension + programmatic upsert-ingest endpoint
- [ ] Ask: unified query UI across memories/files/history with source citations

### Phase 5 — Breadth and polish
- [ ] Additional platform coverage for the browser extension (each is nontrivial ongoing maintenance — the extension "rides" each site's DOM/page structure and breaks silently on redesigns)
- [ ] Desktop app for local coding-agent chat folders (Claude Code/Codex/Cursor-equivalent), read-only file watching, idle-based sync
- [ ] File buckets: upload → text extraction → chunk → embed → cite-by-page search
- [ ] Image memories: upload → multimodal embedding + AI caption → 4-hour signed URL delivery pattern
- [ ] Bucket sharing with role-based permissions (Viewer/Contributor/Editor) and per-memory attribution
- [ ] Knowledge graph (lowest priority — explicitly not part of the recall path, purely a visualization feature)

### Explicitly out of scope / open problems (don't over-promise these in a clone either)
- Reliable resolution of *which* of two contradicting historical facts is current — unsolved industry-wide, not a checkbox
- True end-to-end encryption while retaining server-side search/synthesis — mutually exclusive with the core value proposition as architected
- A cost-effective "narrate the whole history of X over time" feature — MemoryPlugin itself shipped and then paused this (their "timeline tool") because a naive implementation ingests a million-plus tokens per request; only revisit with a map-reduce summarization design, not a single giant context call

---

## 10. Glossary of terms used precisely in the source material

- **Notebook vs. Archive** — MemoryPlugin's own naming for its two layers: Notebook = curated explicit facts (small, always-present); Archive = full chat history (large, consulted on demand, never fully loaded).
- **Admission control** — the rule that an AI may *propose* a memory/edit but a human or explicit tool call must *admit* it into the store. The dividing line between "curated" and "self-writing" memory.
- **Confabulation** — a memory that never happened but passes every retrieval check because similarity search has no concept of ground truth; defended against by tying writes to a verifiable signal.
- **Resolved vs. relevant** — a closed/settled fact and an open one can be equally similar to a query; without an explicit resolution-state field, a system will happily resurface settled questions.
- **RRF (Reciprocal Rank Fusion)** — merge multiple ranked lists by summing `1/(k+rank+1)` per list, avoiding cross-retriever score-scale mismatches.
- **Fail open** — degrade to "no memory" rather than breaking the chat on a backend outage; must be paired with visible error logging, not silent empty results.
