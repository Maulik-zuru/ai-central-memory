# Move chat-history summarization from write-time (whole transcript) to read-time (query-shaped)

**Status:** accepted

`summary.service.ts` today generates one summary per conversation, once, asynchronously right after
sync completes, over the entire transcript — a write-time digest. `MemoryPlugin_Clone_Spec.md` §5.4
and §7.6 describe the real product's recall path as summarizing *at read time*, shaped by the actual
query, specifically because "a pre-written digest of a conversation keeps whatever seemed generically
important and silently drops whatever a specific later question actually needs." We're keeping the
existing write-time summary (it's genuinely useful as a list-view preview, per `US-ARC-05`) but adding
a second, read-time summarization step inside the recall pipeline itself (Phase 17), so a query about
a narrow detail isn't limited to whatever the write-time pass happened to keep.

Hard to reverse (recall latency and cost both go up — read-time summarization means an LLM call on
the hot path of every chat-history query, not a one-time background cost — so this is a real budget
commitment, not a free improvement); surprising without this note (a reader will otherwise wonder why
a working, cheaper write-time summary is being duplicated rather than just reused for recall); genuine
trade-off (per-query cost and the ~2-second recall latency budget the spec itself names, vs. the
detail-loss failure mode of a static digest).

## Considered options

- **Reuse the existing write-time summary as the recall answer.** Rejected — this is what the recall
  path effectively does today by returning raw truncated previews with no synthesis at all, which is
  even further from the target than reusing the digest would be; either way it fails the "shaped by
  the actual query" requirement.
- **Make the write-time summary richer/longer so it covers more detail up front.** Rejected — no
  fixed-size digest, however long, can anticipate every future question; the spec's point is
  architectural (when you summarize, not how much), not a size tuning problem.

## Consequences

- Phase 17's read-time summarization step needs its own token budget (spec: ~600 default / 2,000 cap
  for an "inject"-style endpoint, ~2,000 for raw synthesis) independent of the write-time summary's
  budget.
- For conversations too large for one read-time summarization pass, a progressive map-reduce fold
  (summarize a chunk, carry the running summary into the next chunk) is needed rather than one giant
  context call — named explicitly in the spec as the failure mode MemoryPlugin's own paused "timeline
  tool" ran into.
- The write-time summary (`summary.service.ts`) is not being removed or replaced by this decision —
  it stays as the list-view preview `US-ARC-05` already relies on. The two summarization paths now
  serve genuinely different purposes and should not be collapsed back into one to "avoid duplication."
