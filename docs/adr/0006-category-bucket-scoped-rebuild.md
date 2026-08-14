# Rebuild Category as per-bucket and batch-categorized, wiping existing rows rather than migrating them

**Status:** accepted

`Category` today is scoped per-account (`userId`, `@@unique([userId, label])`) and populated
incrementally: every new memory's embedding is nearest-centroid-matched against that account's
existing categories the moment it's saved (`categorization.service.ts`), joining one if it's within
`CATEGORY_DISTANCE_THRESHOLD` or spawning a new one otherwise. `MemoryPlugin_Clone_Spec.md` §5.1
describes a different mechanism: an LLM reads *all* memories in *one bucket* in a single batch pass,
clusters them into a handful of named categories, and writes each a `summary` plus an
"Additional Info" field the spec is explicit matters more than the summary for recall quality —
gated at a ≥30-memory minimum and never running over 600,000 tokens/2,000 memories. Phase 20
replaces the incremental per-account mechanism with this batch per-bucket one, per
`docs/MemoryPlugin_Parity_Implementation_Plan.md`'s own Phase 20 scope ("replacing the current
incremental per-memory centroid-matching approach").

We're wiping every existing `Category` row (and, via the existing `Memory_categoryId_fkey ...
ON DELETE SET NULL`, un-categorizing every memory that pointed at one) rather than writing a
backfill migration, because there is no lossless mapping from the old rows to the new shape:

- An old category is scoped to one **account**, and can legitimately contain memories from several
  different buckets. The new model requires exactly one `bucketId` per category. Splitting an old
  category into per-bucket fragments changes its identity (its `memoryCount` and `centroid`, and
  now its `label`, would no longer describe the same set of memories that account/label pair used
  to name), not just its storage location.
- Old rows have no `summary`/`additionalContext` — both are now required (`NOT NULL`), written once
  by the same batch call that creates the category. There is no honest value to backfill: a
  generated-after-the-fact summary of "whatever memories happen to still point at this row" is not
  the same as the spec's intended summary of a deliberately-clustered batch, and shipping a
  low-effort placeholder would silently look like real product data forever.

Hard to reverse (once wiped, an account's prior category assignments — which memory was in which
group — cannot be recovered short of re-running the batch job from scratch); surprising without
this note (a reader will otherwise assume a schema change of this size always ships with a backfill,
and wonder why this one doesn't); low actual cost (every account, on next visiting Smart Memory
settings, sees "not categorized yet" and can re-run the batch job — categories are a derived,
regenerable view over memory content, not a source of truth that only exists in that row).

## Considered options

- **Backfill: assign each old category to whichever bucket holds the most of its memories, generate
  `summary`/`additionalContext` from that category's existing memory list.** Rejected — produces
  categories that look real and untouched (same `id`, same `createdAt`) but silently dropped whatever
  memories weren't in the "winning" bucket, and their AI-written summary/additionalContext would be a
  same-day retrofit passed off as if the batch job had originally produced it. Worse than an honest
  "not categorized yet" state, not better.
- **Keep the account-scoped table as a second, legacy `Category` model alongside a new per-bucket
  one, migrate readers gradually.** Rejected — the whole point of Phase 20 is that "category" means
  one thing (per-bucket, summary-bearing); running two schemas with the same name's old and new
  meaning simultaneously is exactly the kind of ambiguity ADR-0002 already rejected for a much
  smaller case (bucket type).

## Consequences

- `categorization.service.ts`'s incremental centroid-matching, and its only call site
  (`embedding.service.ts`'s fire-and-forget `categorizationService.run()` after every embed), are
  retired outright — Phase 20 introduces an explicit, on-demand batch job instead (owner-triggered
  per bucket, not run automatically on every memory write).
- A memory saved after its bucket's last categorization run stays uncategorized (`categoryId: null`)
  until the owner re-runs categorization — there is no more "new memory quietly joins an existing
  category automatically" behavior. This is a real, deliberate UX change the spec's own "re-run
  Smart Memory" action (owner-only, per `MemoryPlugin_Clone_Spec.md` §3.2) implies: categorization is
  something you (re-)run, not something that's always silently current.
- `category.service.ts`'s `list()`/`listMemories()`/`rename()` move from `userId`-scoped queries to
  `bucketId`-scoped ones directly on `Category.bucketId`, rather than the bucket `bucketId` param
  being a narrowing filter on top of account scope as it was before this phase.
