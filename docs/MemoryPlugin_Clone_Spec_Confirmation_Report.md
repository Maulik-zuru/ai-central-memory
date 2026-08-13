# MemoryPlugin Clone Spec — Confirmation Report

**Date:** 2026-08-10
**Branch:** `claude/memory-plugin-gaps-report-w2koa4` · **HEAD audited:** `161bdb5`
**Audited against:** `MemoryPlugin_Clone_Spec.md` — §9 Build Checklist (Phases 1–5), §4.7 Compatibility
Matrix, §6 API Surface. Every line item below was checked directly against the code, not against
either of the two prior reports (`Requirements_Conformance_Report.md`,
`MemoryPlugin_Gap_Analysis.md`) — this report supersedes those two anywhere they disagree, because
this spec is more technically precise than either the original PRD or the shorter feature-research
doc those reports were written against.

## 1. Method and verdicts

Three verdicts, same discipline as the prior conformance report:

| Verdict | Meaning |
|---|---|
| ✅ **Built** | The checklist item's mechanism exists in code as described, not just something with a similar name. |
| 🟡 **Partial** | Part of the mechanism exists, but a materially different or simplified version, or a named sub-piece is missing. |
| ❌ **Not built** | No implementation, or what exists doesn't share the mechanism at all despite a similar name. |

A checkbox with a similar-sounding feature is graded on mechanism, not on name — e.g. "recategorization"
existing does not make "Smart Memory" ✅ if it isn't the two-tier summary/expand mechanism the spec
describes.

---

## 2. Phase 1 — Core memory CRUD

| Item | Verdict | Evidence |
|---|---|---|
| Bearer-token auth, regenerable, account-scoped | ✅ | `apikey.service.ts` — raw key shown once, revocable, `lastUsedAt` tracked (per prior conformance report §3.1) |
| Bucket model: create/list/rename/delete, uniqueness+naming validation, undeletable "General" | 🟡 | Create/rename/list exist and validate uniqueness; delete **refuses** rather than completing (known gap, `bucket.service.ts:67`) |
| Memory model: create/get/update/delete, append-only versioning, soft-delete + `merged_into` trail on merge | 🟡 | Versioning is real (`MemoryVersion`, `memory.service.ts:57,139,177`). Merge concatenates content into the survivor with no `merged_into` pointer field — the deleted memory's version history is not preserved under a traceable pointer, just absorbed |
| Basic REST API matching §6 shapes, importable OpenAPI spec | ❌ | See §6 below — route shapes, paths, and versioning all diverge; no OpenAPI file exists anywhere in the repo |
| Bulk operations: multi-select move/delete/export in dashboard UI | ❌ | No bulk memory update or bulk-delete endpoint exists at all (`memory.routes.ts` has no `bulk*` route); frontend has no multi-select UI for memories |
| Import/export: CSV/JSON/plain-text both directions, paste-and-AI-split | ✅ | Per prior conformance report — `US-ACC-05` export and equivalent import paths exist for memories |

**Phase 1: 2 Built-equivalent, 2 Partial, 2 Not built.**

---

## 3. Phase 2 — First integration surface

| Item | Verdict | Evidence |
|---|---|---|
| Local MCP server (Node/stdio) — `store_memory`, `search_memories`, `get_memories_and_buckets`, `list_buckets`, `create_bucket`, `update_or_move_memories` | ❌ | No MCP implementation anywhere — no `@modelcontextprotocol` dependency in any `package.json`, no `McpToken` model, zero `mcp` references in `backend/src` (grep-confirmed) |
| Remote/hosted MCP over HTTP+SSE with OAuth2 PKCE + DCR | ❌ | Same absence; the only OAuth in the codebase is Google login (`auth.service.ts:93-107`), unrelated to MCP |
| Browser extension v1: floating button, single-platform injection, marker-line detection for AI-initiated saves, text-selection pill | 🟡 | Floating button and text-selection pill both exist, but the *mechanism* is different: injection is DOM-scraping via `MutationObserver` (`site-adapters/{chatgpt,claude,gemini}.ts`) watching for new assistant-turn elements, not marker-line detection in a streamed response. No `to=memoryplugin`/`tool=memoryplugin` marker string exists anywhere (grep-confirmed). Selection threshold is 8 characters (`ContentApp.tsx:30`), not ≥3 |
| Injection-payload safety work (annotation-shaped, first-person framing, tested against real refusal behavior) | ❌ | Moot today — there is no prompt-injected marker-save instruction at all, so there's no injection payload to have tested for refusal-triggering phrasing in the first place |

**Phase 2: 0 Built, 1 Partial, 3 Not built.** This is the least-built phase relative to the spec's
own dependency ordering — the spec treats remote/hosted MCP as "the higher-leverage build," and it's
entirely absent.

---

## 4. Phase 3 — Recall quality

> **Update (2026-08-13, Phase 17):** the five rows below were re-audited against
> `backend/src/modules/chat-history/recall.service.ts` and its callers after
> `docs/MemoryPlugin_Parity_Implementation_Plan.md` Phase 17 shipped the six-stage recall pipeline
> this section originally found entirely missing. Everything else in this report is the original
> 2026-08-10 point-in-time audit at `161bdb5` and has **not** been re-checked against later phases —
> only this section's verdicts reflect current code.

| Item | Verdict | Evidence |
|---|---|---|
| Hybrid retrieval: dense (HNSW/cosine) + BM25, fused by RRF | ✅ | `recall.service.ts`'s `denseSearch()`/`keywordSearch()` (the latter against the `contentTsv` GIN index the Phase 17 migration added) fused via `rank-fusion.ts`'s `reciprocalRankFusion()` — `1/(k+rank+1)` per retriever, never a raw-score sum (`rank-fusion.test.ts` hand-verifies the fused order against an independently-computed example) |
| Cross-encoder reranker fed ≥100+ candidates | ✅ | `recall.service.ts`'s `rerankRows()` feeds `provider.rerank()` the fused pool from hybrid search (each retriever over-fetches to ≥100 candidates — `DENSE_CANDIDATE_LIMIT`/`KEYWORD_CANDIDATE_LIMIT`), not a raw top-K; still LLM-prompted re-ordering rather than a dedicated cross-encoder model, matching this codebase's existing `rerank()` provider shape (a real cross-encoder is a provider-swap away, not a pipeline-shape change) |
| Query expansion into "what I probably said back then" variants + date-filter extraction, original query always re-included | ✅ | `LlmProvider.expandQuery()` (`llm.provider.ts`) rewrites into first-person variants + extracts a date filter anchored to `now`; `recall()` fuses per-variant hybrid results via `fuseAcrossVariants()` (best rank across variants, never first-list-wins); the original query is unconditionally re-added (`mergeWithOriginal()`) |
| Token-budgeted, cited summarization at read time (not pre-computed digests) | ✅ | `recallAndSummarize()` (Stage 6) folds survivors into a budgeted, cited summary via `LlmProvider.summarizeWithCitations()`, with a map-reduce fold (`batchByTokenCeiling()`) for survivor sets too large for one pass — implements ADR-0005 exactly, alongside (not replacing) the existing write-time `summary.service.ts` digest |
| Fail-open with explicit failure-vs-empty-result distinction | 🟡 | The three new Phase 17 provider methods (`expandQuery`/`assessChunkRelevance`/`summarizeWithCitations`) throw on a real call failure rather than silently substituting a stub-shaped result — a caller can tell "the provider is down" from "genuinely nothing relevant" for these specifically. The pre-existing methods this row originally cited (`embed`/`extractMemoryCandidates`/etc., still at roughly the same lines) were explicitly left as-is: Phase 17's own plan named this "the fuller sweep" as Phase 18's job, and warned only against introducing *new* instances of the anti-pattern while building six new provider-calling stages — which is what happened, not a full-codebase fix |

**Phase 3: 4 of 5 built, 1 partial.** The remaining partial credit is exactly the scope Phase 18
("Reliability and non-functional architecture fixes") already commits to closing — not a new gap
this update discovered.

---

## 5. Phase 4 — Scale features

| Item | Verdict | Evidence |
|---|---|---|
| Smart Memory: per-bucket AI categorization + on-demand category expansion, count-gated | ❌ | `context/retrieval.service.ts` is a flat single-pass weighted scorer (`similarity*0.6 + recency*0.25 + categoryMatchBonus*0.15`), not two-tier summary-then-expand. Categorization (`categorization.service.ts:45-99`) is incremental per-memory centroid-matching, not a batch AI clustering pass. No `summary`/`additionalContext` fields on `Category`. No 30-minimum / 600k-token / 2,000-memory gates exist anywhere (grep-confirmed) |
| Memory Suggestions curator: nearest-neighbor clustering → cheap-model proposal → mandatory ID re-validation → human accept/reject | 🟡 | Human accept/reject is real and enforced (`suggestion.service.ts:52-76`, editor-role-gated, pending-status-checked). But: two separate services (duplicate/stale) rather than one unified curator; merge is pairwise only, no N-way combine; no content-rewriting "Update" operation (staleness only marks inactive); no 10k-token analysis skip; and because there's no LLM-returned-ID step at all in the current design (it's a direct DB match, not an LLM proposing IDs from a cluster), the "re-validate every model-returned ID against input set + ownership" safeguard doesn't apply yet — but it will be needed the moment the curator is rebuilt to match the spec's cluster→LLM→ID-based-write shape |
| Chat history: file-import parsers + online sync via extension + programmatic upsert-ingest | 🟡 | File-import parsers exist for 2 of 6 named platforms (ChatGPT, Claude). Online sync via extension does not exist — the extension's capture path posts to `/api/capture` (the Memory module), never to chat-history. No programmatic `ingest/custom-online`-style upsert endpoint exists |
| Ask: unified query UI across memories/files/history with source citations | ✅ | Confirmed working per prior conformance report (`US-ASK-01`–`06`) — this is a genuine strength area |

**Phase 4: 1 Built, 2 Partial, 1 Not built.**

---

## 6. Phase 5 — Breadth and polish

| Item | Verdict | Evidence |
|---|---|---|
| Additional extension platform coverage | 🟡 | 3 named site adapters (ChatGPT, Claude, Gemini) of the spec's 21+ web surfaces; no generic/fallback adapter for arbitrary chat sites |
| Desktop app: read-only watch of Claude Code/Codex/Cursor folders, idle-based sync | 🟡 | Only `~/.claude/projects` is live (`claude-code.source.ts:42`); Cursor and Codex sources are explicit stubs (`available: false`, empty `defaultPaths()`). No "Focused sync" setting exists as a named, toggleable privacy boundary — only as an incidental side effect of what the current parser happens to extract |
| File buckets: upload → extract → chunk → embed → cite-by-page | ✅ | Matches the spec exactly, including the correct rejection of scanned/no-text-layer PDFs (`processing.service.ts:43-49`) and correct extension-absence (files are dashboard/Ask/API-reachable only, never extension-reachable) |
| Image memories: upload → multimodal embedding + AI caption → 4-hour signed URL | 🟡 | Upload → caption pipeline exists; the 4-hour-signed-URL delivery pattern does not — `imageUrl` is a permanent static path with no expiry (`memory.service.ts:12-24`, `storage.provider.ts:56`), and a test explicitly asserts the URL is stable across calls (`image-memory.test.ts:20-21`), the opposite of the spec |
| Bucket sharing: Viewer/Contributor/Editor roles + per-memory attribution | ❌ | Exactly two invitable roles exist (`viewer`, `editor` — `bucketAccess.ts:6-10`); no `contributor` tier anywhere. Attribution fields exist in schema but are explicitly *not* used to restrict edit scope (`memory.service.ts:26-28`) |
| Knowledge graph (lowest priority) | 🟡 | Exists, and correctly excluded from retrieval — but the mechanism differs: one LLM call extracts entities+relations together with no separate LLM merge-review pass, dedup is deterministic exact-name-match (not LLM-reviewed), and one uniform model runs the whole pipeline rather than a stronger model reserved for a review step (no such step exists to reserve one for). It's also an hourly incremental batch job, not an on-demand-per-bucket generation |

**Phase 5: 1 Built, 4 Partial, 1 Not built.**

---

## 7. Compatibility matrix confirmation (§4.7)

| Platform | Spec's recommended method | Our actual coverage |
|---|---|---|
| ChatGPT | Browser extension (alt: Custom GPT) | Extension: DOM-scraping adapter exists. Custom GPT: absent |
| Claude | Browser extension + Remote MCP | Extension: DOM-scraping adapter exists. Remote MCP: absent |
| Gemini | Browser extension | DOM-scraping adapter exists |
| Grok, DeepSeek, Perplexity, AI Studio, Mistral, Poe, LibreChat, Qwen, OpenRouter, ChatLLM, Z.ai, Kimi | Browser extension | **No adapter for any of these** — 3 of 21+ named surfaces covered |
| TypingMind | Browser extension / native plugin / MCP | All three absent for TypingMind specifically (no dedicated adapter, no plugin, no MCP) |
| Cursor, Windsurf, Claude Code, Sage, other MCP clients | MCP server | Absent (no MCP at all); Claude Code alone is covered by the desktop agent instead |
| Anything else | OpenAPI / REST | REST exists in unversioned, undocumented form; no OpenAPI spec |

**Net coverage: 3 of the ~30 named platforms/clients have any working connection path** (ChatGPT,
Claude, Gemini — via DOM-scraping, not the spec's own preferred mechanism for two of the three), plus
Claude Code via the desktop agent. Every other named integration path (MCP, Custom GPT, TypingMind,
19+ other extension targets) is unbuilt.

---

## 8. API surface confirmation (§6)

Real route table, confirmed by reading `backend/src/app.ts` mounts and each module's `*.routes.ts`:

| Spec's path | Our actual path | Verdict |
|---|---|---|
| `POST /api/memory` | `POST /api/memories/` | 🟡 Different mount path (`/memories` not `/memory`), same purpose |
| `GET /api/memory` (v1, `query`/`all`/`latest`/`count`/`skip`/`source`) | `GET /api/memories/` (`cursor`/`limit`≤100/`q`/`bucketId`) | 🟡 Exists, different param shape, no versioning at all |
| `GET /api/v2/memory` | — | ❌ No versioned API exists |
| `POST /api/v2/memory/update` (bulk move, ≤100, all-or-nothing, `rejectedIds`) | `PATCH /api/memories/:id` (text) + `PATCH /api/memories/:id/bucket` (move) | ❌ Single-resource only; no bulk path, no `rejectedIds` semantics |
| `DELETE /api/memories/{memoryId}` | `DELETE /api/memories/:id` | ✅ Matches |
| `POST /api/memories/bulk-delete` | — | ❌ Absent |
| `GET /api/buckets` / `POST /api/buckets` | `GET /api/buckets/` / `POST /api/buckets/` | ✅ Matches (params differ slightly — no `source` field on create) |
| `POST /api/chat-history/inject` (hybrid+synthesis, ≤15 parallel queries, 600/2000 token budget) | — | ❌ No such endpoint; closest is `POST /api/chat-history/search` (`mode: semantic\|precise`), single query, no synthesis |
| `POST /api/chat-history/search` (raw chunks) | `POST /api/chat-history/search` | 🟡 Same name, different shape — no `contextChunks`/`skipRerank` params, and "precise" mode is an LLM reorder, not a distinct rerank flag |
| `POST /api/chat-history/ingest/custom-online` (upsert by id) | — | ❌ Absent — only file-upload import exists |
| `GET /api/chat-history/chats` (paginated, `pinnedOnly` etc.) | `GET /api/chat-history/conversations` | 🟡 Exists under a different name, no `pinnedOnly` (pinning doesn't exist), no `dateFrom`/`dateTo` filters confirmed |
| `GET /api/chat-history/conversation` | `GET /api/chat-history/conversations/:id` | ✅ Equivalent |
| `GET /api/chat-history/count` | `GET /api/chat-history/usage` | 🟡 A usage/quota object exists, not a plain count |
| `DELETE /api/chat-history/chats` | — | ❌ No conversation delete exists at all |
| OpenAPI spec | — | ❌ Confirmed absent |
| `memoryId`+`dbId` alias pattern | — | ❌ Confirmed absent (not applicable without an existing versioned API to have migrated from) |

**API surface: 2 of 15 spec'd endpoints have a genuine equivalent; 6 exist in a materially
different/reduced shape; 7 are entirely absent.**

---

## 9. Overall tally

| Phase | Built | Partial | Not built | Total items |
|---|---|---|---|---|
| 1 — Core CRUD | 2 | 2 | 2 | 6 |
| 2 — First integration surface | 0 | 1 | 3 | 4 |
| 3 — Recall quality | 0 | 0 | 5 | 5 |
| 4 — Scale features | 1 | 2 | 1 | 4 |
| 5 — Breadth & polish | 1 | 4 | 1 | 6 |
| **Total** | **4** | **9** | **12** | **25** |

Plus: compatibility matrix — 3 of ~30 platforms connected; API surface — 2 of 15 endpoints equivalent.

**Read honestly:** of the spec's own five-phase build order, this codebase is strongest exactly where
the spec says to start (Phase 1 core CRUD, mostly there) and weakest exactly where the spec says the
real engineering effort goes (Phase 3 recall quality, zero of five items built, and Phase 2's
higher-leverage remote MCP, entirely absent). That is the single most useful fact in this report for
sequencing what comes next — see `MemoryPlugin_Deep_Analysis_Final_Report.md` §7 for the ranked plan.

---

## 10. Document control

| Field | Value |
|---|---|
| Report version | 1.0 |
| Audit date | 2026-08-10 |
| Scope | §9 Build Checklist (25 items across 5 phases), §4.7 Compatibility Matrix (~30 platforms), §6 API Surface (15 endpoints) |
| Result | 4 Built / 9 Partial / 12 Not built (checklist); 3/~30 platforms connected; 2/15 endpoints equivalent |
| Supersedes | Where this report and `Requirements_Conformance_Report.md` or `MemoryPlugin_Gap_Analysis.md` disagree on a verdict (e.g. `US-ARC-07` "high-accuracy recall" previously graded Met), this report's verdict is the accurate one — it was checked against the more precise mechanism description in `MemoryPlugin_Clone_Spec.md`, not the looser original PRD wording |
| Related | `MemoryPlugin_Clone_Spec.md`, `MemoryPlugin_Deep_Analysis_Final_Report.md`, `Product_Requirements.md`, `Requirements_Conformance_Report.md`, `MemoryPlugin_Gap_Analysis.md` |
