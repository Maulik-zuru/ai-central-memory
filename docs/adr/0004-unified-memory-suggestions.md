# Unify duplicate-detection and stale-detection into one Memory Suggestions curator

**Status:** accepted

`duplicate-detection.service.ts` and `stale-detection.service.ts` are today two independent services
producing two `MemorySuggestion.type` values (`duplicate`, `stale`), each with its own detection
threshold and its own frontend card component. `MemoryPlugin_Clone_Spec.md` §5.2 describes the real
product as one feature — "Memory Suggestions" — with exactly three operation types (Remove, Combine,
Update), run per-cluster (a memory's nearest neighbors handed to one model call that proposes one of
the three moves), not as two parallel pairwise-comparison passes. We're merging them into one curator
service and one suggestion taxonomy.

Hard to reverse (touches the `MemorySuggestion` schema's `type` enum and every piece of frontend UI
that branches on it, plus the merge operation's data shape changes from strictly-pairwise to N-way);
surprising without this note (a reader familiar with the current two-service split will otherwise
assume unifying them is unmotivated refactoring rather than a deliberate parity fix); genuine
trade-off (one curator pass with one clustering step, vs. two independent, simpler, already-working
comparison passes).

## Considered options

- **Keep two services, just relabel `duplicate`→`Remove` and `stale`→`Update`.** Rejected — a
  rename doesn't add the missing `Combine` (N-way) operation, doesn't add the mandatory
  LLM-returned-ID revalidation-against-ownership safeguard the spec calls "the only thing standing
  between [hallucinated IDs] and a corrupted store" (which only matters once the curator moves from
  direct-threshold comparison to an LLM proposing memory IDs from a cluster), and keeps the current
  10,000-token-skip gap unaddressed.
- **Add `Combine` and `Update` as two more independent services alongside the existing two.**
  Rejected — the spec's own design is one pass over nearest-neighbor clusters producing one of three
  moves per cluster, not three (or four) independent full-bucket scans; running them separately would
  multiply LLM calls over the same data for no benefit.

## Consequences

- `MemorySuggestion.type` becomes `'remove' | 'combine' | 'update'`; existing `duplicate`/`stale`
  rows need a migration mapping (`duplicate`→`remove`, `stale`→`update` as the default, since today's
  `stale` rows were never classified as `replaces` vs. `extends` — see ADR-0003).
- `combine` suggestions need a `memoryIds: string[]` shape (N-way) instead of the current
  `memoryIdA`/`memoryIdB` pair columns.
- `update` suggestions need to carry proposed *new content* for the stale memory, not just a
  pointer to mark inactive — this is the "content-rewriting Update operation" gap the deep-analysis
  report calls out; today's staleness flow has nothing to rewrite because it never proposed new text.
- The curator must re-validate every model-returned memory ID against the actual input cluster and
  the caller's ownership before any write — required the moment ID selection moves from direct DB
  lookup to LLM output, per the spec's explicit incident history (a merge once discarded a usage
  statistic; another silently dropped a "since 2023" timestamp).
- Frontend `DuplicateCard`/`StaleCard` collapse into one suggestion-card component branching on the
  three operation types, with a pending-count badge per bucket and a "Check for new" manual scan
  action (both named explicitly in the spec's UI description).
