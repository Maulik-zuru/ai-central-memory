# Add a `supersedes` relation on Memory instead of one undifferentiated "stale" suggestion

**Status:** accepted

Stale-memory detection today flags any pair of memories whose embeddings fall in a fixed
cosine-distance band as one generic `MemorySuggestion` of type `stale`, with no way to tell a genuine
contradiction ("moved to Lisbon" replacing "lives in Berlin") from a mere addition ("added a second
phone number" extending, not replacing, an existing fact) — both produce the identical suggestion
shape for a human to sort out by hand. `MemoryPlugin_Clone_Spec.md` §7.5 states this as a structural
principle: "distinguish 'replaces' (a genuine contradiction) from 'extends' (adds detail without
invalidating anything) — collapsing both into a blind overwrite is how real information gets lost."
We're adding a `supersedes: Memory?` self-relation, set only when a suggestion is approved as a
genuine replacement (not on every mid-similarity pair), so the store keeps a queryable "what did I
believe as of last Tuesday" trail rather than an undifferentiated inactive-flag.

Hard to reverse (a self-referencing FK on `Memory` plus a `MemoryVersion`-adjacent history query
change); surprising without this note (a reader will otherwise wonder why staleness handling got more
complex instead of simpler); genuine trade-off (write-time contradiction detection, which this ADR
keeps, vs. the spec's own alternative of read-time resolution via ranking — see ADR-0005 for where we
land on that question for chat history specifically; memory contradiction detection is staying
write-time because a human is already in the loop approving every suggestion, which is exactly the
condition under which write-time diffing is cheap and safe).

## Considered options

- **Keep one `stale` type, no relation, just mark old memory inactive on approval.** Rejected —
  matches today's code exactly and is the thing this ADR exists to move away from; loses the
  "replaces vs. extends" distinction the spec calls out by name.
- **Model it as a full validity-interval (`validFrom`/`validTo`) on every memory instead of a
  pairwise relation.** Rejected for this pass — more general, but nothing in the current product
  needs "what was true as of an arbitrary date" as a first-class query; a `supersedes` pointer
  answers the concrete case (this memory replaced that one) without committing to interval semantics
  the rest of the schema doesn't support yet.

## Consequences

- `stale-detection.service.ts` needs to classify a flagged pair as `replaces` or `extends` (an LLM
  judgment call, not just the existing distance-band membership check) before creating the
  suggestion — the distance band alone was never sufficient to tell these apart and shouldn't be
  treated as if it were.
- Approving a `replaces` suggestion sets `supersedes` on the new memory pointing at the old one and
  marks the old one inactive, as today; approving an `extends` suggestion should not deactivate
  anything — it's a signal the two memories are related, not that one is wrong.
- `Memory.supersedes` needs to be walkable both directions (what did this replace; what replaced
  this) for any future "history of this fact" view.
