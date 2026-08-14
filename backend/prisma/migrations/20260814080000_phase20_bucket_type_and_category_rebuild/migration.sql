-- Phase 20 (ADR-0002, ADR-0006): Bucket gets an immutable `type` discriminator, and Category is
-- rebuilt from per-account (incremental centroid-matching) to per-bucket (batch-categorized, with
-- `summary`/`additionalContext`). See ADR-0006 for why existing Category rows are wiped rather
-- than migrated: the old rows have no well-defined single bucket (a category could span every
-- bucket the account owned) and were never written with a summary/additionalContext, so there is
-- no lossless backfill — this dev database's 4 leftover rows are exactly the kind of stale,
-- schema-incompatible data this decision is about.

-- 1. Bucket.type — default 'memory' for every existing row, then backfill 'file' for buckets that
--    hold at least one File and no Memory (ADR-0002's stated inference rule for pre-existing rows).
ALTER TABLE "Bucket" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'memory';

UPDATE "Bucket" b
SET "type" = 'file'
WHERE EXISTS (SELECT 1 FROM "File" f WHERE f."bucketId" = b.id)
  AND NOT EXISTS (SELECT 1 FROM "Memory" m WHERE m."bucketId" = b.id);

-- 2. Category rebuild. Deleting every row first (rather than trying to backfill bucketId/summary/
--    additionalContext) also SETs NULL on every Memory.categoryId pointing at one, via the existing
--    `Memory_categoryId_fkey ... ON DELETE SET NULL` — exactly the "loses its category, keeps
--    everything else" behavior a category deletion already has.
DELETE FROM "Category";

ALTER TABLE "Category" DROP CONSTRAINT "Category_userId_fkey";
DROP INDEX "Category_userId_idx";
DROP INDEX "Category_userId_label_key";

ALTER TABLE "Category" DROP COLUMN "userId";
ALTER TABLE "Category" ADD COLUMN "bucketId" TEXT NOT NULL;
ALTER TABLE "Category" ADD COLUMN "summary" TEXT NOT NULL;
ALTER TABLE "Category" ADD COLUMN "additionalContext" TEXT NOT NULL;

CREATE INDEX "Category_bucketId_idx" ON "Category"("bucketId");
CREATE UNIQUE INDEX "Category_bucketId_label_key" ON "Category"("bucketId", "label");

ALTER TABLE "Category" ADD CONSTRAINT "Category_bucketId_fkey"
  FOREIGN KEY ("bucketId") REFERENCES "Bucket"(id) ON UPDATE CASCADE ON DELETE CASCADE;
