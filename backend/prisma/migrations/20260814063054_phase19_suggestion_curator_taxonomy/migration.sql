-- Phase 19 (ADR-0004 "unify duplicate-detection and stale-detection into one Memory Suggestions
-- curator"): MemorySuggestion moves from a strictly-pairwise memoryIdA/memoryIdB shape to one
-- ordered memoryIds list (supporting combine's N-way merge), and from the old "duplicate"/"stale"
-- (Phase 3) / "replaces"/"extends" (Phase 18.6, ADR-0003) types to the spec's own three:
-- "remove" | "combine" | "update".
--
-- Every DROP INDEX statement Prisma auto-generated ahead of this file's real change, plus the
-- unrelated "ALTER COLUMN contentTsv DROP DEFAULT" (a Prisma model-drift artifact, not an actual
-- change this migration is making), have been removed — same recurring trap documented in
-- 20260808190000_restore_vector_indexes/migration.sql and every Phase 17/18 migration since.

-- AlterTable: add the new column first, alongside the old ones, so the data migration below can
-- read memoryIdA/memoryIdB before they're dropped.
ALTER TABLE "MemorySuggestion" ADD COLUMN "memoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Data migration for existing rows (dev/test data only — this branch has never shipped to real
-- users). "duplicate" approved via a keep-A/merge-away-B 2-way merge — "remove" targets the
-- absorbed side (B) first, A kept as context. "stale"/"replaces"/"extends" all collapse into
-- "update", targeting the older memory (A) exactly as stale-detection.service.ts already did;
-- none of them ever captured rewritten content, so draftContent stays NULL for these — approving
-- one post-migration is a safe no-op rather than a crash (see suggestion.service.ts).
UPDATE "MemorySuggestion"
SET "memoryIds" = ARRAY_REMOVE(ARRAY["memoryIdB", "memoryIdA"], NULL)
WHERE "type" = 'duplicate';

UPDATE "MemorySuggestion"
SET "memoryIds" = ARRAY_REMOVE(ARRAY["memoryIdA"], NULL)
WHERE "type" IN ('stale', 'replaces', 'extends');

UPDATE "MemorySuggestion" SET "type" = 'remove' WHERE "type" = 'duplicate';
UPDATE "MemorySuggestion" SET "type" = 'update' WHERE "type" IN ('stale', 'replaces', 'extends');

-- Now safe to drop the columns the migration above finished reading from.
ALTER TABLE "MemorySuggestion" DROP COLUMN "memoryIdA",
DROP COLUMN "memoryIdB";
