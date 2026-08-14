# Add a Contributor role between Viewer and Editor on shared buckets

**Status:** accepted

Shared buckets today have two roles — Viewer (read-only) and Editor (can edit/delete anyone's
memory in the bucket, including the owner's). `MemoryPlugin_Clone_Spec.md` §3.2 documents a third,
default-on-invite role, Contributor: can add memories, but can only edit/delete the ones they
themselves added. We're adding it because the two-role model has no way to express "let this person
contribute without giving them edit rights over everyone else's content," which is the common case
for an invited collaborator who isn't the bucket's primary maintainer — Editor is currently the only
option above read-only, so every invite is an all-or-nothing grant of full edit rights.

This is hard to reverse (every `requireAccess`/`requireBucketMembership` call site and the frontend
role selector need to agree on the same rank ordering, and shared-bucket data already carries
`memory.userId`/`MemoryVersion.changedBy` attribution that this role depends on being enforced,
not just recorded), so recording it here rather than letting it fall out of an unremarked schema
migration.

## Considered options

- **Keep two roles, let Editors self-police.** Rejected — it's exactly the gap the source product
  closes, and "trust everyone with edit access" is not a permission model, it's the absence of one.
- **Make Contributor the ceiling (no separate Editor tier), i.e. everyone who isn't the owner can
  only edit their own content.** Rejected — the spec is explicit that Editor (edit-anyone's-content)
  is a real, distinct, useful tier above Contributor, and collapsing them would remove a capability
  the current two-role model already has.

## Consequences

- `ROLE_RANK` in `backend/src/shared/bucketAccess.ts` gains a `contributor` tier between `viewer`
  and `editor`; every ordinal comparison against it needs re-auditing, not just the new checks.
- `requireAccess()` in `memory.service.ts` needs a caller-vs-`memory.userId` comparison specifically
  for the `contributor` case — every other role currently ignores who created the content, and that
  has to stay true for `viewer`/`editor`, changing only for `contributor`.
- `category.service.ts`'s recategorization gate (currently `role: { in: ['editor', 'owner'] }`)
  should become owner-only as part of this change — see `MemoryPlugin_Clone_Spec.md` §3.2 ("Only the
  owner can... re-run Smart Memory"), which this codebase currently violates independently of the
  Contributor question.
