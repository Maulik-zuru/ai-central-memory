# AI Memory & Context Platform — Backend Build Plan (Phase-Wise)

**Companion document:** `Frontend_Plan.md` (same phase numbers, so the two teams can build in lock-step)

---

## 1. Purpose & Scope

This plan scopes the backend build for an in-house clone of the MemoryPlugin product category. The
core engineering challenge is not CRUD — it's the **retrieval and context-assembly engine** that sits
between three data layers (Memories, Chat History, Files) and a dozen-plus external AI surfaces.
13 phases (0–12), each independently shippable and testable.

Everything in the source feature inventory (Account, Memory, Organization, Chat Archive, Files, Ask,
Integrations, Infrastructure/Intelligence, Security) is placed into a phase — see the **Feature
Coverage Matrix** in Section 6.

## 2. Assumptions & Tech Stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| API framework | Express.js (Node/TypeScript) | Route → controller → service layering by domain (memory, bucket, archive, files, ask, integrations); keep controllers thin, business logic in services |
| ORM | Prisma | Single `schema.prisma` as the source of truth for every entity in Section 4; `prisma migrate` drives schema changes; generated client gives end-to-end type safety from DB → service → (shared) API types |
| Primary DB | PostgreSQL | Relational core: users, memories, buckets, files metadata |
| Vector store | pgvector (in Postgres) to start; Qdrant/Pinecone if scale demands | Avoids a second DB early on; Prisma can call pgvector similarity ops via raw SQL (`$queryRaw`) since it isn't a native Prisma type |
| Cache/queues | Redis + BullMQ | Sync jobs, embedding jobs, summarization jobs |
| Object storage | S3-compatible bucket | Files, images, exports |
| LLM provider | Abstracted provider layer (Anthropic/OpenAI interchangeable) | Used for capture, classification, summarization, RAG synthesis |
| MCP server | Official MCP SDK (Node) | Exposes tools: memory search, chat-history recall, file search |
| Auth | JWT (access+refresh) + OAuth (Google) + hashed API keys | Session for dashboard, API key for programmatic/MCP/plugin access |
| Billing | Stripe | Subscriptions, metered usage, webhooks |
| Infra | Containerized Express services behind an API gateway; managed Postgres/Redis | CI/CD to staging/prod |

**Suggested folder shape** (keeps Express from turning into one giant `routes.ts`):
```
src/
  modules/
    memory/       (memory.routes.ts, memory.controller.ts, memory.service.ts)
    bucket/
    archive/
    files/
    ask/
    integrations/
  prisma/
    schema.prisma
  shared/         (auth middleware, error handler, rate limiter, types shared w/ frontend)
```

## 3. High-Level Architecture

```
                    ┌─────────────────────┐
                    │   Web / Extension   │
                    │   / MCP / Plugins   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │      API Gateway     │  (auth, rate limit, API keys)
                    └──────────┬──────────┘
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
   │  Memory Svc │      │  Archive Svc │      │  Files Svc  │
   │ (CRUD, dedupe,│    │ (import/sync,│      │ (upload,    │
   │  versions)  │      │  summaries)  │      │  chunk, RAG)│
   └──────┬──────┘      └──────┬──────┘      └──────┬──────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │   Retrieval Engine   │  (embeddings, categorization,
                    │  (Smart Memory core) │   ranking, context assembly)
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │      Ask Service     │  (query routing + LLM synthesis
                    │                     │   + citation assembly)
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │  Integration Layer   │  (extension API, MCP server,
                    │                     │   Custom GPT actions, TypingMind,
                    │                     │   Open API, desktop sync agent)
                    └─────────────────────┘

     Cross-cutting: Auth/Billing Svc · Vector Store · Object Storage ·
                     Job Queue (embedding/sync/summarize) · Audit/Analytics
```

## 4. Core Data Model (entities → Prisma models, not final schema)

| Entity | Key fields |
|---|---|
| `User` | id, email, password_hash, oauth_ids, plan_id, created_at |
| `ApiKey` | id, user_id, key_hash, name, scopes[], last_used_at |
| `Subscription` | id, user_id, plan(core/pro), status, trial_ends_at, stripe_ids |
| `Bucket` | id, owner_id, name, type(personal/work/project/custom), parent_id, is_shared |
| `BucketMember` | bucket_id, user_id, role(owner/editor/viewer), invited_at, accepted_at |
| `Memory` | id, bucket_id, user_id, content, type(text/image), image_url, source(auto/manual/one-click), embedding, status(active/stale/merged/deleted), created_at, updated_at |
| `MemoryVersion` | id, memory_id, content_snapshot, changed_by, changed_at, change_type |
| `MemorySuggestion` | id, type(duplicate/stale/new), memory_id_a, memory_id_b, status(pending/approved/dismissed) |
| `Platform` | id, name, category(chat/ide/agent), auth_method |
| `Conversation` | id, user_id, platform_id, external_id, title, summary, bucket_id, imported_at |
| `Message` | id, conversation_id, role, content, embedding, created_at |
| `SyncJob` | id, user_id, platform_id, status, cursor_hash, started_at, completed_at |
| `File` | id, user_id, bucket_id, filename, mime_type, storage_path, status(processing/ready/error) |
| `FileChunk` | id, file_id, chunk_text, page_number, section, embedding |
| `AskConversation` | id, user_id, mode(memories/chat_history/files/all), title, created_at |
| `AskMessage` | id, ask_conversation_id, role, content, sources_json, created_at |
| `KnowledgeGraphNode` | id, user_id, label, type, metadata |
| `KnowledgeGraphEdge` | id, from_node_id, to_node_id, relation, source_ref |
| `UsageAnalyticsEvent` | id, user_id, event_type, metadata, occurred_at |
| `AuditLog` | id, user_id, action, target_type, target_id, occurred_at |
| `McpToken` / `TypingMindConnection` / `CustomGptConnection` / `DesktopAgentDevice` | integration-specific credentials & pairing state |

---

## 5. Phase-Wise Delivery Plan

### Phase 0 — Foundations & Environment Setup
**Objective:** Infra and scaffolding ready before feature services are built.
- Monorepo/service scaffold, shared DTO/type package with frontend
- Postgres + pgvector provisioned; Redis provisioned; S3 bucket provisioned
- CI/CD, Prisma schema + migration workflow (`prisma migrate dev` / `deploy`), secrets management, staging/prod environments
- LLM provider abstraction layer (single interface, swappable backend) stubbed
- Observability baseline: structured logging, error tracking, health checks
**Exit criteria:** A "hello world" service can read/write Postgres and Redis in staging via CI/CD.

### Phase 1 — Accounts, Auth & API Foundations
**Objective:** Users, sessions, and API keys are real.
- `User` model, email/password auth, OAuth (Google), JWT access+refresh tokens
- **API key** issuance/revocation service (hashed at rest, scoped)
- `Subscription` model skeleton (plan field only; billing logic comes in Phase 10)
- Rate limiting middleware at the gateway (per-user and per-key)
- Audit log write-path (used by every later phase)
**Depends on:** Phase 0. **Feeds:** Frontend Phase 1.
**Exit criteria:** A registered user can authenticate via session and via a generated API key against
a protected test endpoint.

### Phase 2 — Core Memory System ("The Notebook")
**Objective:** Memory is a fully functional, versioned, deduplicated store.
- Memory CRUD API; `MemoryVersion` write-on-every-change (append-only history)
- **Automatic capture pipeline:** LLM call over a conversation snippet → structured
  fact-extraction → draft memory → returned for confirmation (never silently saved)
- **Manual/one-click capture** endpoint (lower-latency path, no extraction step)
- **Image memory** storage (object storage + metadata row)
- Embedding generation on create/update (async job)
- **Duplicate detection**: nearest-neighbor search on embeddings + threshold → `MemorySuggestion`
- **Stale-memory detection**: heuristic (e.g., contradicting embeddings/entities over time) →
  `MemorySuggestion`
- Approve/Dismiss/Merge endpoints (merge = combine content, keep version lineage)
**Depends on:** Phase 1. **Feeds:** Frontend Phase 2.
**Exit criteria:** Creating two near-duplicate memories produces a duplicate suggestion within
seconds; editing a memory produces a retrievable version history.

### Phase 3 — Buckets & Organization
**Objective:** Ownership, grouping, and sharing permissions exist as first-class concepts.
- `Bucket` and `BucketMember` models; CRUD + move/assign endpoints
- Bucket-scoped queries reused by Memory, File, and Ask services (shared query filter, not duplicated
  logic)
- **Shared buckets:** invitation service (email + accept token), role enforcement middleware
  (owner/editor/viewer) applied across all bucket-scoped endpoints
**Depends on:** Phase 2. **Feeds:** Frontend Phase 3.
**Exit criteria:** A viewer-role member can read but not edit memories in a shared bucket; an editor
can.

### Phase 4 — Smart Memory & Context Retrieval Engine
**Objective:** The core differentiator — relevant-only context assembly.
- **Categorization service:** classifies memories into categories (LLM-assisted or embedding-cluster
  based), keeps category labels stable over time
- **Intent understanding:** given a live conversation snippet, classify which categories are relevant
- **Retrieval + ranking:** vector similarity + recency + category match → ranked memory subset
- **Context assembly with token budgeting:** pack the ranked subset into a size-bounded context
  string; expose a "would-inject" preview endpoint (used by Frontend Phase 4)
- Caching layer for repeated similar queries (Redis)
**Depends on:** Phase 2–3. **Feeds:** Frontend Phase 4; consumed by Ask (Phase 7) and Integrations
(Phase 8).
**Exit criteria:** Given 100+ seeded memories, a sample conversation retrieves a small, relevant
subset and the token count is measurably reduced vs. sending everything.

### Phase 5 — Chat History Archive (Import + Sync)
**Objective:** External conversations become a searchable, deduplicated archive.
- **Per-platform connectors/parsers** for the six supported import sources (file-based export parsing
  and/or API-based pull, depending on what each platform allows)
- **Idempotent sync jobs:** content-hash or external-id based dedupe so re-syncing never creates
  duplicate `Conversation`/`Message` rows
- Chunking + embedding of messages for **semantic search**
- **Summarization pipeline** (LLM) producing per-conversation summaries (Pro)
- **Monthly insights job:** scheduled aggregation across a user's conversations → digest record (Pro)
- **High-accuracy recall:** dedicated ranking pass (rerank top-K semantic results with an LLM) for
  precision-critical queries
- Plan-based limits enforced (last 500 vs. unlimited)
**Depends on:** Phase 1, 3. **Feeds:** Frontend Phase 5; consumed by Ask (Phase 7).
**Exit criteria:** Running the same import twice produces zero duplicate conversations; a semantic
query returns a relevant conversation even without exact keyword overlap.

### Phase 6 — Files & Document Knowledge Base (RAG)
**Objective:** Uploaded documents become queryable with citations.
- Upload endpoint → object storage; async **parsing** (PDF/DOCX/MD/TXT text extraction)
- **Chunking strategy** (page/section-aware) + embedding per chunk (`FileChunk`)
- File status state machine (processing → ready/error), exposed via webhook/SSE to the frontend
- **RAG query endpoint:** retrieve top-K chunks, return with page/section metadata for citation
- File-bucket scoping (reuses Phase 3 bucket model)
**Depends on:** Phase 3. **Feeds:** Frontend Phase 6; consumed by Ask (Phase 7).
**Exit criteria:** A query against an uploaded PDF returns an answer plus the exact page it came from.

### Phase 7 — The "Ask" Unified Query System
**Objective:** One retrieval-augmented endpoint that spans all three data layers.
- **Query router:** given a mode (memories/chat_history/files/all), fan out to the relevant
  retrieval services (Phase 2/4, 5, 6) in parallel
- **Synthesis:** LLM call combining retrieved snippets into one answer
- **Citation assembly:** attach source type + identifier + snippet to the response so the frontend
  can render clickable references
- `AskConversation`/`AskMessage` persistence (resumable threads)
- Bucket-scoped Ask queries (reuse Phase 3 filter)
**Depends on:** Phases 2, 4, 5, 6. **Feeds:** Frontend Phase 7.
**Exit criteria:** A single Ask query can return an answer sourced from a memory, a past conversation,
and a file simultaneously, each cited correctly.

### Phase 8 — Cross-AI Integrations
**Objective:** Expose the retrieval engine to external AI tools.
- **Extension API:** lightweight endpoints for Quick Inject (fetch a bucket's assembled context) and
  one-click save (fast path into Phase 2's manual-capture endpoint)
- **MCP server:** tools for memory search, chat-history recall, and file search, both hosted and
  runnable locally; auth via `McpToken`
- **Custom GPT actions:** OpenAPI schema exposing a safe subset of the API (search/recall, not raw
  account management)
- **TypingMind plugin backend:** function-call endpoints matching TypingMind's plugin contract
- **Open/public API:** documented REST API (OpenAPI spec, versioned), scoped by `ApiKey`
- **Desktop sync agent protocol:** local agent (macOS) watches Claude Code/Codex/Cursor session data
  and pushes new context up via an authenticated device channel (`DesktopAgentDevice`)
- **Agent Skills:** packaged skill definitions (instructions + tool references) for Claude Code /
  Codex / Cursor that call the recall/save endpoints
- Platform registry (`Platform` table) drives which of the 20+ AI tools show as "supported" and how
**Depends on:** Phases 2–7. **Feeds:** Frontend Phase 8.
**Exit criteria:** The same bucket's context can be pulled via the extension, via MCP from Cursor, and
via the public API, and all three return consistent results.

### Phase 9 — Advanced Intelligence (Pro tier)
**Objective:** Higher-order intelligence over the accumulated data.
- **Knowledge graph extraction:** entity/relationship extraction job over memories + conversations →
  `KnowledgeGraphNode`/`Edge`, with `source_ref` back to the originating memory/message for
  attribution
- **Usage analytics pipeline:** event ingestion (`UsageAnalyticsEvent`) + scheduled aggregation for
  dashboard charts
- Monthly insights (built in Phase 5) surfaced through a dedicated read endpoint here
**Depends on:** Phases 2, 5. **Feeds:** Frontend Phase 9.
**Exit criteria:** The graph for a test account correctly links a project memory to a client bucket
and a related past conversation, each edge traceable to its source.

### Phase 10 — Billing, Plans & Monetization
**Objective:** Core vs. Pro is enforced server-side, not just in the UI.
- Stripe integration: checkout, subscription lifecycle webhooks, trial (7-day) and refund (14-day)
  handling
- **Plan-gating middleware:** every Pro-only endpoint (knowledge graph, unlimited history, shared
  buckets beyond a cap, summaries/insights/analytics) checks `Subscription.plan`
- Usage metering (conversation count, memory count if ever capped, sync limits)
**Depends on:** Phase 1. **Feeds:** Frontend Phase 10.
**Exit criteria:** Downgrading a test account immediately restricts Pro-only endpoints; Stripe webhook
failures are retried and logged, not silently dropped.

### Phase 11 — Security, Privacy & Compliance
**Objective:** Data handling matches the stated privacy commitments.
- **Encryption in transit** (TLS everywhere) and **at rest** (DB/object-storage encryption) verified
  in infra config, not just documented
- **Data export job:** async job that bundles a user's memories/conversations/files into a
  downloadable archive
- **Permanent deletion pipeline:** cascading hard-delete across Postgres, vector store, and object
  storage (with a short grace period + audit log entry, if desired)
- Explicit isolation of user data from any model **training** pipeline (technical guarantee, not just
  a policy statement) and a **no-data-sale** boundary enforced by not exposing raw user content to any
  third-party analytics/ad pipeline
- GDPR/CCPA-style request handling workflow (export/delete requests tracked to completion)
**Depends on:** Phase 1. **Feeds:** Frontend Phase 11.
**Exit criteria:** An export request and a delete request both complete end-to-end and are verifiable
in the audit log.

### Phase 12 — QA, Performance & Launch Readiness
**Objective:** The system holds up under real load before launch.
- Load testing on the retrieval engine (Phase 4) and Ask (Phase 7) — the two most compute-heavy paths
- Vector store scaling plan (pgvector index tuning or migration trigger to a dedicated vector DB)
- Caching/CDN for static assets; connection pooling review
- Monitoring/alerting on sync-job failure rates, embedding-job backlog, LLM API error rates
- Backup and disaster-recovery drill (restore from backup end-to-end)
- Staged rollout plan (internal → beta cohort → general availability)
**Depends on:** All prior phases. **Exit criteria:** Documented load-test results within target
latency/error budgets; a successful backup-restore drill on record.

---

## 6. Feature Coverage Matrix (backend-owned surface)

### Account
| Feature | Phase |
|---|---|
| Registration/login (auth service) | 1 |
| API keys (issuance, hashing, scopes) | 1 |
| Subscription / plan management | 10 |
| Data export | 11 |
| Data deletion | 11 |
| Privacy controls (technical enforcement) | 11 |

### Memory
| Feature | Phase |
|---|---|
| Automatic capture pipeline | 2 |
| Manual capture / one-click save | 2 |
| Edit / Delete | 2 |
| Image memories (storage) | 2 |
| Duplicate detection | 2 |
| Stale-memory detection | 2 |
| Merge memories | 2 |
| Approve/dismiss suggestions | 2 |
| Version history (storage) | 2 |
| Unlimited memory (no artificial cap) | 2 |
| Smart Memory (categorization + retrieval) | 4 |
| Memory recall | 4, 7 |

### Organization
| Feature | Phase |
|---|---|
| Buckets (schema) | 3 |
| Bucket filtering (shared query logic) | 3 |
| Shared buckets (RBAC) | 3 |
| Team invitations | 3 |

### Chat Archive
| Feature | Phase |
|---|---|
| Import conversations (connectors) | 5 |
| Six supported import platforms | 5 |
| Automatic sync (idempotent jobs) | 5 |
| Semantic conversation search | 5 |
| Full transcripts (storage/retrieval) | 5 |
| Conversation retrieval | 5 |
| High-accuracy recall (rerank pass) | 5 |
| Conversation summaries | 5 |
| Monthly insights | 5, 9 |
| Usage analytics | 9 |
| Knowledge graph | 9 |

### Files
| Feature | Phase |
|---|---|
| File upload (storage) | 6 |
| PDF / Word / Markdown / Text parsing | 6 |
| File buckets | 6 |
| File search | 6 |
| Document chunking/RAG | 6 |
| Page/section references | 6 |
| File Q&A (RAG query) | 6 |

### Ask
| Feature | Phase |
|---|---|
| Memory / Chat History / Files modes | 7 |
| Natural-language querying | 7 |
| AI synthesis | 7 |
| Source references | 7 |
| Saved Ask conversations | 7 |
| Bucket filtering | 7 |

### Integrations
| Feature | Phase |
|---|---|
| Browser extension API | 8 |
| Custom GPT actions | 8 |
| MCP (hosted + local) | 8 |
| TypingMind plugin backend | 8 |
| Open API | 1, 8 |
| Desktop app sync protocol | 8 |
| Agent Skills | 8 |

### Infrastructure / Intelligence
| Feature | Phase |
|---|---|
| Semantic search | 5, 6 |
| Vector/RAG retrieval | 4, 6, 7 |
| Context selection | 4 |
| Smart categorization | 4 |
| Context injection | 4, 8 |
| Token optimization | 4 |
| Duplicate detection | 2 |
| Stale-memory detection | 2 |
| AI summarization | 5 |
| Knowledge graph | 9 |
| Source attribution | 7, 9 |

### Security
| Feature | Phase |
|---|---|
| HTTPS / encryption in transit | 0, 11 |
| Encryption at rest | 0, 11 |
| User-controlled memory (delete/edit endpoints) | 2, 11 |
| Export | 11 |
| Permanent deletion | 11 |
| No selling of data / no training on user data | 11 |

---

## 7. Non-Functional Requirements

- **Security:** all endpoints authenticated (session or API key); role checks enforced server-side,
  never trusted from the client.
- **Scalability:** retrieval engine (Phase 4) and Ask (Phase 7) are the hot paths — design for
  horizontal scaling and caching from the start, not as a later refactor.
- **Observability:** every async job (embedding, sync, summarization, knowledge-graph extraction) has
  a status, retry policy, and dead-letter handling.
- **Compliance:** export/delete requests must be traceable end-to-end in the audit log for any future
  regulatory request.

## 8. Risks & Open Questions

- Vector search at scale: pgvector is fine to start, but a migration path to a dedicated vector DB
  should be decided *before* Phase 5/6 data volumes grow, not after.
- LLM cost control: automatic capture, categorization, summarization, and Ask synthesis all call an
  LLM — needs per-plan rate limits and cost monitoring from Phase 2 onward.
- Platform-connector fragility: chat-history import connectors depend on each source platform's export
  format/API, which can change without notice — build with a versioned-parser pattern so one platform
  breaking doesn't block the others.
- Idempotent sync correctness (no duplicate conversations on re-sync) is easy to get subtly wrong —
  worth a dedicated test suite in Phase 5, not just manual QA.

## 9. Note on Originality

This plan clones the **feature set and system behavior** described in the source analysis, not any of
MemoryPlugin's copyrighted code, prompts, or proprietary implementation details (none of which were
available to build from anyway). The architecture, data model, and pipelines above are original
engineering design meant to achieve equivalent functionality.
