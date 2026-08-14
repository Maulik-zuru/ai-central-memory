# MemoryPlugin Clone — Deep Technical Analysis & Final Report

**Date:** 2026-08-10
**Branch:** `claude/memory-plugin-gaps-report-w2koa4` · **HEAD audited:** `161bdb5`
**Purpose:** a single, deep, mechanism-level analysis of how this codebase compares to
`MemoryPlugin_Clone_Spec.md` — with particular depth on *how the real product connects to different
AI platforms* (the question that started this whole thread), the recall pipeline internals, and the
architectural principles that determine whether any of this actually works well once built, not just
whether a checkbox exists. `MemoryPlugin_Clone_Spec_Confirmation_Report.md` is the companion
checklist-style scorecard; this document is the narrative "why it matters and what to do" behind it.

---

## 1. The one-sentence finding

**This codebase has a real memory CRUD core and a real Ask/Files layer, but almost none of what
makes MemoryPlugin's actual product work — its integration breadth, its recall pipeline, and its
write/read architectural discipline — exists yet.** Of the spec's own 25-item, 5-phase build
checklist, 4 items are genuinely built, 9 are partially built, and 12 don't exist at all — and the 12
missing items cluster almost entirely in the two phases the spec itself calls the highest-leverage
work (Phase 2's remote MCP, Phase 3's recall quality).

---

## 2. How MemoryPlugin actually connects to different AIs — and how we compare, mechanism by mechanism

This is the part of the spec most directly relevant to the original question. MemoryPlugin does not
have one integration mechanism reused everywhere — it has **four structurally different mechanisms**,
chosen per-platform based on what that platform's surface actually exposes. Here is each one, what it
requires to build correctly, and exactly how far this codebase is from it.

### 2.1 Browser extension — prompt injection with a marker-line protocol

**How the real product does it:** the extension doesn't call a function. It edits the composer
(prepends memory context before send) and then *reads the AI's own reply looking for a specific text
pattern* — `to=memoryplugin&&memory=[text]` (ChatGPT: `tool=memoryplugin&&memory=...`) — that the
injected instruction told the model to emit. This is a **fake tool call made of plain text**: the
model was never given a real function, so the extension manufactures the appearance of one by
convention, then intercepts it client-side before the user ever sees the raw marker line. The spec is
explicit that getting the *wording* of the injected instruction right is itself the hard engineering
problem here (§4.1 of the spec) — a directive-shaped payload ("The user has enabled the following
plugin...") gets refused by RLHF'd models as a suspected injection attack; the fix is annotation-shaped,
first-person framing with no ceremony ("[note to self: ...]").

**What we actually built:** a different, older-generation mechanism entirely — DOM scraping. Three
site-specific adapters (`extension/src/lib/site-adapters/{chatgpt,claude,gemini}.ts`) each hardcode CSS
selectors and run a `MutationObserver` watching for new assistant-turn elements to appear in the page,
then read that element's `textContent` directly and hand it to the capture pipeline
(`extension/src/content/ContentApp.tsx:44-62`). There is no marker string anywhere in the codebase
(confirmed by grep for `to=memoryplugin`/`tool=memoryplugin`) — meaning there's also no injected
instruction to have tested for refusal behavior, because nothing is asking the model to emit anything.

**Why this matters beyond "different implementation":** DOM scraping and marker-line interception have
opposite failure modes and opposite platform-coverage economics. DOM scraping breaks silently on every
UI redesign of every site you support (the spec itself calls this out in Phase 5 as "nontrivial ongoing
maintenance"), and it fundamentally cannot capture anything the model didn't literally render to the
page — it can never ask the model to *decide* something is worth remembering, only observe what
happened to appear. Marker-line interception is more fragile per-message (it depends on the model
choosing to follow an injected instruction) but scales to new platforms without touching a single CSS
selector, and — critically — it's the *only* mechanism of the two that lets the AI proactively decide
"this is worth remembering," rather than a human always making that call after the fact. Our current
approach also means the entire "AI decides, human confirms" capture story (`US-MEM-03`, already built)
only works because a human happens to be reading the whole reply anyway; on a platform whose DOM changes,
it goes silent with no signal to anyone.

**Coverage gap:** 3 of the spec's 21+ named web surfaces have any adapter at all (ChatGPT, Claude,
Gemini). Grok, DeepSeek, Perplexity, Mistral, Poe, Qwen, LibreChat, OpenRouter, AI Studio, NotebookLM,
ChatLLM, Z.ai, Kimi, TypingMind, and MiniMax have none.

### 2.2 MCP — real tool calls, two auth tiers

**How the real product does it:** an actual Model Context Protocol server exposing 13 real,
independently-callable tools (§4.2 of the spec) — not text convention, genuine function calls a
client like Claude Code or Cursor can invoke. Two deployment tiers exist because they solve different
trust problems: a **local** server (`npx @memoryplugin/mcp-server`, a static bearer token in a JSON
config file) for technical users who are comfortable running a local Node process, and a **remote/
hosted** server (`https://www.memoryplugin.com/api/mcp/{mcp,sse}`) using OAuth 2.0 + PKCE + Dynamic
Client Registration, where the client self-registers on first connect and the user approves access in
a browser popup — no static secret ever touches a config file. The spec calls the remote tier "the
higher-leverage build" specifically because local-only forces every user through a Node.js setup step
most non-developers will never complete.

**What we actually built:** nothing. Zero MCP references anywhere in `backend/src` or
`backend/prisma` (grep-confirmed), no `@modelcontextprotocol` dependency in any `package.json` across
the whole repo, no `McpToken` model among the schema's 30 models. This is not a partial build with a
missing auth tier — it's a complete absence of the entire integration path.

**What backing logic already exists to build on top of** (this matters for scoping the work
correctly — most of the *logic* a future MCP server would wrap already exists, it just isn't exposed
as callable tools):

| MCP tool | Existing backing logic |
|---|---|
| `store_memory` | `memory.service.ts:45` `create()` |
| `get_memories_and_buckets` | `memory.service.ts:103` `list()` + `bucket.service.ts:87` `list()` |
| `search_memories` | `retrieval.service.ts:88` `buildContext()` |
| `list_buckets` | `bucket.service.ts:87` `list()` |
| `create_bucket` | `bucket.service.ts:32` `create()` |
| `update_or_move_memories` | `memory.service.ts:133,155` `update()`/`move()` — **single-memory only today; batch 1–100 semantics is net-new** |
| `list_bucket_categories` | `category.service.ts:8` `list()` — **user-scoped not bucket-scoped, no summary field — net-new work needed** |
| `list_category_memories` | **No backing logic exists — net new** |
| `recall_chat_history` | `ask.service.ts:114` `ask()` + `chat-search.service.ts:57` `topCandidates()` — but see §3 below on how far this is from the spec's actual six-stage pipeline |
| `get_conversation_summary` | `conversation.service.ts:41` `getTranscript()` + `summary.service.ts:8` `summarize()` |
| `get_full_conversation` | `conversation.service.ts:41` `getTranscript()` |
| `export_conversation` | **No backing logic exists — net new**; closest analog is whole-account export (`export.service.ts:104-235`, 7-day TTL, not per-conversation, not 15-minute) |
| `search_uploaded_files` | `file-search.service.ts:70` `search()` |

Three of thirteen tools (`update_or_move_memories`' batch mode, `list_category_memories`,
`export_conversation`) need genuinely new service code, not just a wrapper. The other ten are mostly
wiring — which makes the *absence* of any MCP server at all the real gap, not a lack of underlying
capability.

### 2.3 Custom GPT / GPT Actions — ChatGPT's own tool-calling path

**How the real product does it:** two flavors. An official ready-made Custom GPT requires zero setup
from the user but is captive to whichever models OpenAI currently permits Custom GPTs to run on. The
build-your-own path imports MemoryPlugin's OpenAPI spec as a GPT Action and — this is the detail worth
internalizing — pastes a specific, carefully engineered instruction block into the GPT's system
instructions that encodes bucket semantics, explicit ID-hallucination guardrails ("Do not guess bucket
IDs, they are random"), and a quick-save shortcut convention (`\m`/`+m`). The spec calls this "the
clearest evidence in the whole doc set that prompt-engineering the tool-use instructions is itself a
first-class part of the integration" — the OpenAPI spec alone is not the integration; the instruction
block that tells the model *how to use it correctly* is equally load-bearing.

**What we actually built:** nothing, and there's nothing to build the instruction block against yet
either, because there's no OpenAPI spec for anyone to import as an Action in the first place (confirmed
absent, §4 below).

### 2.4 TypingMind plugin

**How the real product does it:** a native plugin exposing the identical function surface as MCP,
authenticated with a pasted token instead of OAuth — deliberately the simplest of the four mechanisms
because TypingMind's plugin system already does real function calling, no marker-text workaround
needed.

**What we actually built:** nothing.

### 2.5 Desktop app — local coding-agent chat sync

**How the real product does it:** a menu-bar app watching exactly three named, hardcoded folders
read-only (`~/.claude/projects`, `~/.codex/sessions`, `~/.cursor/projects`), defaulting to "Focused
sync" — uploading only the user's prompts and each turn's *final* answer, with tool output, file
contents, terminal commands, and model "thinking" guaranteed to never leave the machine *regardless of
setting*. It waits for a chat to go idle 15 minutes before syncing, with a manual "Sync Now" override,
and gates the sync capability itself behind a paid plan while keeping already-synced local browsing
free on any plan.

**What we actually built:** one of the three folders is live (`~/.claude/projects`,
`desktop/src/main/sources/claude-code.source.ts:42`); Cursor and Codex sources are explicit stubs
(`available: false`, empty `defaultPaths()`). There is no "Focused sync" setting anywhere in
`AgentConfig`/`AgentSettings` (`desktop/src/main/config.ts:25-31`, grep-confirmed) — what gets
uploaded today is simply whatever the transcript parser happens to extract (`type:"text"` blocks
only), which *incidentally* excludes tool calls but is a fixed parsing detail, not a named, auditable
privacy guarantee a user can see and rely on. That distinction matters: nothing today stops a future
parser change from also uploading tool-call content, because there's no policy enforcing the boundary
— only an accident of what the current code happens to parse.

### 2.6 Direct REST / OpenAPI

**How the real product does it:** a documented, versioned, Bearer-token REST API any external tool
(n8n, Zapier, Make, Postman, custom code) can call directly — this is explicitly the fallback for
"anything not natively supported," and it's also what backs the Custom GPT Action path (§2.3) for
free once it exists.

**What we actually built:** an unversioned, undocumented REST API with materially different route
shapes than the spec (see §4 below), and no OpenAPI file anywhere in the repo.

### 2.7 Cross-cutting observation

Every one of the four mechanisms above shares one property in the real product that's easy to miss
when building them independently: **they all read and write the same underlying account**, so using
several integrations together (extension for capture, MCP for recall in Claude, REST for a personal
automation) never produces duplicate or conflicting data — because they're all thin adapters over one
store. That property is actually *true today by architectural accident* — our memory/bucket data model
is already a single Postgres store with no per-integration duplication — the gap isn't in the data
layer, it's that only one of the four adapters (the browser extension, and only 3-of-21+ platforms of
it) has been built at all. Getting MCP and REST/OpenAPI built correctly is mostly an *exposure* problem
on top of an already-correct data layer, not a data-model redesign.

---

## 3. The recall pipeline — a forensic, stage-by-stage comparison

The spec's chat-history recall pipeline (§5.4) is the single most technically detailed subsystem in
the whole document, and it's where this codebase differs from the spec the most severely. The spec
describes six stages, run fresh on every query. Here is each stage against the actual code
(`chat-search.service.ts`, `ask.service.ts`):

| Stage | Spec's mechanism | Actual code | Gap |
|---|---|---|---|
| 1. Query expansion | LLM rewrites the query into several "what I probably said back then" variants + extracts a date filter; original query always kept | `chat-search.service.ts:102-104`, `ask.service.ts:147` — the literal user string is embedded once, no rewrite, no variants, no date extraction | **Full gap.** No query expansion exists at all |
| 2. Hybrid search + RRF | Every variant runs both dense (HNSW/cosine) and BM25 search; lists fused by Reciprocal Rank Fusion (`1/(k+rank+1)`, never a weighted sum) | pgvector cosine distance only (`<=>` operator); no BM25 index, no fusion | **Full gap.** This is the spec's own "single most consequential implementation detail in the whole system" (§7.3) and it's entirely absent — not present in a simplified form, just not present |
| 3. Cross-encoder rerank | A dedicated reranking model reorders the fused pool | `chat-search.service.ts:123-130` — `precise` mode is a single LLM completion asked to output a reordered list of indices | **Mechanism mismatch.** What exists is a prompted LLM reorder, not a cross-encoder reranker — different cost/latency/accuracy profile entirely |
| 4. Per-chunk relevance assessment | LLM judges each surviving candidate: does it *actually* answer the query (spec: this step dominates latency) | `ask.service.ts:22,93` — a static distance-threshold filter (`RELEVANCE_DISTANCE_CEILING = 0.6`) | **Full gap.** A fixed numeric cutoff is not a per-candidate judgment call — it can't distinguish "close in embedding space but doesn't actually answer this" from "close and does" |
| 5. Context expansion | Pull in neighboring messages around each surviving hit | `chat-search.service.ts:57-76`'s `topCandidates()` returns only the single best-matching chunk per conversation (`DISTINCT ON (c.id)`) | **Full gap.** No adjacent-message pull exists |
| 6. Budgeted, cited summarization at read time | Fold survivors into an AI summary within a token budget (600 default/2000 cap for inject, ~2000 for raw synthesis), with citations (conversation/message id, date, score) | Chat search returns raw truncated string previews (`.slice(0,240)`, no LLM call, no citations). The only summarization that exists is `summary.service.ts:8-28` — a **write-time**, whole-transcript, Pro-gated summary generated once right after sync | **Architectural inversion, not just a missing feature.** The spec's central design claim (§5.4, "summarize at read time, shaped by the actual query — not ahead of time") is the *opposite* of what's built. A pre-written digest keeps whatever seemed generically important at write time and silently drops whatever a later, specific question actually needs — which is exactly the failure mode the spec calls out by name |

**Chunking:** the spec calls for ~256-token chunks with light overlap, and for role/timestamp metadata
to be stored as structured fields and deliberately excluded from the text that gets embedded (so
labels don't add embedding noise). The actual chunking (`sync.service.ts:8,13-22`) is character-based
(`MAX_CHUNK_CHARS = 1000`), non-overlapping, plain `content.slice()`. Role and timestamp are indeed
separate structured columns never concatenated into the embedded text — but that's incidental (nothing
was ever added to the embedding pipeline to strip out), not a deliberate design choice matching the
spec's stated reasoning.

**Why this phase matters most:** the spec explicitly frames Phase 3 (recall quality) as "where most of
the real engineering effort goes," and every one of its five checklist items is unbuilt (§4 of the
confirmation report). This is not a UI gap or a missing settings toggle — it is a different retrieval
architecture from what the spec describes, end to end, from the first stage to the last.

---

## 4. Non-functional architecture principles — do we actually follow them?

The spec's §7 lists nine design principles it says matter more than any individual feature checkbox.
Five were checked directly against the code with file:line evidence; the other four are either already
covered by the existing conformance reports or are policy/product-stance items rather than code:

### 4.1 Write path never blocks the response path — **partially matches**
Memory create/update/merge (`memory.service.ts:63,93,142,182`) are genuinely fire-and-forget —
`void embeddingService.process(...)` returns the HTTP response immediately, with the comment at
`embedding.service.ts:9-14` explicitly framing this as "queued, not blocking the save" (though there's
no real queue yet — no BullMQ/Redis, just an in-process async call). But the **extension capture
endpoint breaks this exact principle**: `capture.service.ts:23-24` `await`s an LLM extraction call
inside `submit()`, and the route awaits the whole thing before responding (`capture.routes.ts:13`).
The one path this principle is named for in the spec — "extraction... belongs in a background queue,
always" — is the one path where it's violated.

### 4.2 Fail open, never fail silent — **does not match**
The provider layer fails open by silently substituting a fallback: on any embed/extraction failure,
`llm.provider.ts:373-380` (OpenAI embed), `:415-421` (OpenRouter embed), and `:218-221`
(`extractMemoryCandidates`) all just `logger.error(...)` and return a substitute value (a deterministic
hash-embedding, or a stub extraction) — never a throw, never an error flag. Every downstream caller
(`retrieval.service.ts:104`, `chat-search.service.ts:103`) therefore cannot tell a provider outage from
"genuinely nothing relevant exists" — the spec calls this exact confusion out by name as the failure
mode to avoid ("a saturated inference provider... can return empty results that look identical to 'no
relevant memories found,' which silently defeats the entire feature while reporting itself healthy").

### 4.3 Layered duplicate matching (cheap-first, LLM-last) — **does not match**
`duplicate-detection.service.ts:9,26-38` runs exactly one check for every comparison: a pgvector
cosine-distance query against a single constant threshold (`0.15`). There is no exact-string tier, no
deterministic fuzzy/trigram tier (confirmed: no `pg_trgm`/Levenshtein usage anywhere in the backend),
and no LLM disambiguation step for the ambiguous remainder — embedding similarity is the first, last,
and only check.

### 4.4 Placement ("lost in the middle") — **does not match**
Both `retrieval.service.ts:135-153` and `ask.service.ts:92-107` sort candidates by descending relevance
and walk that list top-to-bottom into the final context under a token budget, with zero repositioning.
Nothing places the strongest memories at the start *and* end of the injected block — everything is in
raw score order.

### 4.5 Version, don't overwrite; distinguish "replaces" from "extends" — **partially matches**
The versioning half is solid — every edit creates a new `MemoryVersion` row rather than overwriting
(`memory.service.ts:57,139,177`). But there's no `supersedes`/`replaces` relationship anywhere.
`stale-detection.service.ts:35-49` flags any pair of memories falling in a 0.15–0.55 cosine-distance
band as an undifferentiated "stale" suggestion — it cannot distinguish a genuine contradiction ("moved
to Lisbon" replacing "lives in Berlin") from a mere addition ("got a new phone number" extending, not
replacing, an existing fact). Every mid-similarity pair gets the identical generic suggestion type for
a human to sort out by hand.

### 4.6 The other four principles (§7.1, 7.2, 7.6, 7.9) — assessed at a glance
- **§7.1 (two pipelines, one store)** — largely true structurally (one Postgres store, write/read
  separated by module), undermined only by the same capture-path exception noted in §4.1 above.
- **§7.2 (no LLM-on-every-write)** — mostly honored for chat history (summarization is the one
  exception — see §3 above, it runs once per conversation, not per message); memory capture does run
  an LLM extraction per capture event, which is the intended design (`US-MEM-03`), not the anti-pattern
  the spec warns against (that's about *background* re-normalization on every turn, not user-initiated
  capture).
- **§7.6 (write-time vs. read-time conflict resolution)** — this codebase resolves at write time for
  memories (`stale-detection.service.ts` runs on every new memory) and — inconsistently — at write time
  for chat history too (§3's write-time summarization), where the spec's own recommendation for chat
  history specifically is read-time. Worth flagging as a deliberate choice to revisit, not just an
  oversight, since the spec argues read-time resolution is the more recent, better-performing pattern
  for exactly this subsystem.
- **§7.9 (privacy/security posture)** — already covered in depth by `Requirements_Conformance_Report.md`
  §3.10 (`US-SEC-01`/`02`): transit encryption real, at-rest encryption asserted but unverifiable (no
  infra exists), no-training enforced technically but pending legal review. Not re-litigated here.

---

## 5. Data model deltas worth calling out explicitly

Beyond the checklist items already in the confirmation report, a few data-model differences are worth
stating because they constrain what's cheaply fixable later vs. what needs a migration:

- **No `merged_into` pointer.** The spec's merge design keeps a soft-delete trail pointing from the
  absorbed memory to its survivor, so "what happened to this fact" stays answerable after a merge. Our
  merge (`memory.service.ts:163-185`) concatenates content into the survivor and does not preserve a
  traceable pointer from the deleted memory — once merged, the absorbed memory's own identity is gone,
  not just inactive.
- **No `supersedes`/`replaces` relation** (§4.5 above) — this is the same gap as the "replaces vs.
  extends" principle, called out again here because it's a schema change, not a service-logic change,
  and schema changes compound in cost the longer other code assumes the simpler shape.
- **No bucket-type discriminator.** `Bucket` (`schema.prisma:106-125`) holds both `Memory[]` and
  `File[]` on one model with no `type` field distinguishing a memory bucket from a file bucket. The
  spec requires Smart Memory to exclude file buckets and buckets merely shared *to* the user — today
  that exclusion is structurally impossible to express, not just unimplemented.
- **No `pinned` field on `Conversation`**, and correspondingly no bulk-delete-with-pin-protection logic
  — confirmed absent from `schema.prisma` by grep.

---

## 6. What this changes about the two prior reports

`Requirements_Conformance_Report.md` and `MemoryPlugin_Gap_Analysis.md` were both written against
looser source material (the original PRD, and a shorter feature-research doc respectively) and graded
several stories "Met" that this deeper spec shows are not built to the real mechanism:

- **`US-ARC-07` "High-accuracy recall"** was graded Met against "re-ranks the top candidates... distinct
  from raw vector order" — true as far as it goes, but §3 above shows the actual mechanism (a single
  LLM-prompted reorder) is not the cross-encoder reranker the real product uses, and none of the other
  five recall-pipeline stages exist around it.
- **`US-ADV-01` "Smart Memory"** and **`US-MEM-06`/`07` "Memory Suggestions"** were already flagged in
  `MemoryPlugin_Gap_Analysis.md` §2.2–2.3 as needing re-scoping as new epics rather than bug fixes —
  this report's Phase 4 findings (confirmation report §5) confirm and sharpen that conclusion with the
  additional detail that the curator's target shape (cluster → cheap LLM → ID-revalidated write) is a
  different pipeline shape from today's direct-threshold-comparison services, not a relabeling.
- **Nothing in this report reverses a previously-"Not built" verdict to something more built** — every
  delta runs in the direction of "more precisely absent than previously known," which is the expected
  direction now that the source material is more technically detailed.

---

## 7. Ranked plan — what to build, in what order, and why

Ordered by the spec's own dependency logic (§9) crossed with what's cheapest to close first:

1. **Close the small, contained Phase-1 gaps first**: bucket delete's move-vs-delete choice, bulk
   memory move/delete endpoints, a `merged_into` pointer on merge. None require new architecture.
2. **Build the REST API to the spec's shape and publish an OpenAPI file.** This is disproportionately
   high-leverage: it directly unlocks the Custom GPT Action path (§2.3) and any n8n/Zapier/REST
   integration (§2.6) for close to free once the routes and spec exist — two of the four integration
   mechanisms, from one piece of work.
3. **Build the remote/hosted MCP server first, local second** — the spec itself ranks these in this
   order for a reason (OAuth+PKCE+DCR removes the Node.js setup barrier that local-only imposes), and
   §2.2's table above shows 10 of 13 tools are mostly wiring over logic that already exists.
4. **Rebuild the chat-history recall pipeline stage by stage**, in the spec's own stage order: hybrid
   dense+BM25 fused by RRF first (§7.3 of the spec calls this the single highest-value fix), then a
   real reranking step, then query expansion, then per-chunk relevance filtering, then read-time
   budgeted summarization with citations replacing the current write-time whole-transcript summary.
   Each stage is independently valuable and independently testable — this doesn't need to ship as one
   giant rewrite.
5. **Fix the two silent-failure patterns** (§4.1's capture-path blocking call, §4.2's fail-open-fail-
   silent embedding fallback) before building more retrieval on top of a foundation that can't tell
   "no memories" from "the embedding provider is down."
6. **Rebuild Memory Suggestions as one curator** with N-way combine, a real content-rewriting Update
   operation, the 10k-token skip, and — once it moves to an LLM-proposes/ID-revalidates shape — the
   mandatory ID re-validation-against-input-and-ownership check the spec calls "the only thing standing
   between [hallucinated IDs] and a corrupted store."
7. **Rebuild Smart Memory as two-tier** (categorize → summarize → load-on-demand) with the real hard
   gates (30-memory minimum, 600k-token/2,000-memory ceiling) and the bucket-type exclusion that needs
   the schema discriminator from §5 first.
8. **Extend platform/integration breadth last**, per the spec's own Phase 5 placement — more browser-
   extension site adapters, the Cursor/Codex desktop-agent folders, TypingMind, image-memory signed
   URLs, the third bucket-sharing role, and the knowledge graph's merge-review step, roughly in that
   order of user-facing impact.

Items 1–3 are the fastest path to closing the integration-breadth gap that motivated this whole
analysis; items 4–7 are the fastest path to making the product actually good once someone is connected
to it — and the spec is consistent that both matter, just in that order.

---

## 8. Document control

| Field | Value |
|---|---|
| Report version | 1.0 |
| Audit date | 2026-08-10 |
| Scope | Integration mechanisms (§4 of the spec), recall pipeline (§5.4/§7.3), non-functional principles (§7), data model (§3), tech stack (§8) |
| Companion document | `MemoryPlugin_Clone_Spec_Confirmation_Report.md` (checklist-style scorecard) |
| Source spec | `MemoryPlugin_Clone_Spec.md` |
| Related, superseded where they disagree | `Product_Requirements.md`, `Requirements_Conformance_Report.md`, `MemoryPlugin_Feature_Research.md`, `MemoryPlugin_Gap_Analysis.md` |
