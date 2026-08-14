# Add a `type` discriminator to Bucket instead of inferring type from contents

**Status:** accepted

`Bucket` today has no `type` field — it holds both `Memory[]` and `File[]` on one model, and
"memory bucket" vs. "file bucket" is purely an emergent property of which relation happens to be
populated. Smart Memory (per `MemoryPlugin_Clone_Spec.md` §3.2/§5.1) is required to run only on the
account's own memory buckets — never file buckets, never buckets merely shared *to* the user — and
that exclusion cannot be expressed today because there's no field to exclude on. We're adding an
explicit `type: 'memory' | 'file'` column, set at creation and immutable after.

Hard to reverse (every bucket-listing/filtering query written against the current schema assumes a
bucket can be inferred rather than declared, and a later migration to backfill `type` on existing
rows needs a correct inference rule applied exactly once); surprising without this note (a reader
will otherwise assume the single-model design was deliberate simplification, not an oversight this
phase is correcting); genuine trade-off (a discriminated single table vs. two separate models).

## Considered options

- **Infer type at query time from whether `File[]` or `Memory[]` is non-empty.** Rejected — breaks on
  an empty bucket (no memories or files yet) and doesn't support the spec's rule that a *file* bucket
  can never become shareable or Smart-Memory-eligible even before it holds a first file.
- **Split into two separate models (`MemoryBucket`, `FileBucket`).** Rejected for this pass — it's
  the more "correct" long-term shape but touches every bucket-access, sharing, and Ask-scoping query
  in the codebase at once; a discriminator column is the smaller, reversible-enough first step, and
  the split can still happen later if the single-model-plus-discriminator shape proves awkward.

## Consequences

- Bucket creation must set `type` immutably; the frontend's "Memory bucket / File bucket" selector
  (already implied by `US-ORG-01`/`US-FIL-02` treating them as one selector) needs to write it.
- Smart Memory's eligibility check (`category.service.ts` / a future two-tier categorization job) can
  now filter on `bucket.type === 'memory' AND bucket.ownerId === userId` directly instead of needing
  new relation-existence logic.
- Existing buckets need a one-time backfill migration inferring `type` from current contents at
  migration time — this is the one-shot inference the "hard to reverse" note above is about; get it
  right in the migration, not as an ongoing runtime check.
