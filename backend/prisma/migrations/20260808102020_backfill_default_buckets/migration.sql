-- Backfill: every user created before Phase 2 needs a default Bucket, since Memory.bucketId is
-- non-null. Uses gen_random_uuid() cast to text to match Prisma's cuid() id shape closely enough
-- for a one-time backfill row (new buckets going forward get real cuids from the app layer).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "Bucket" ("id", "userId", "name", "isDefault", "createdAt")
SELECT gen_random_uuid()::text, "id", 'Personal', true, CURRENT_TIMESTAMP
FROM "User"
WHERE NOT EXISTS (
  SELECT 1 FROM "Bucket" WHERE "Bucket"."userId" = "User"."id" AND "Bucket"."isDefault" = true
);
