-- Backfill: every bucket created before Phase 3 needs its creator's "owner" BucketMember row,
-- since authorization now always checks membership, never Bucket.userId (see
-- docs/Phase3_Implementation_Plan.md §6.1/§6.2).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "BucketMember" ("id", "bucketId", "userId", "role", "invitedAt", "acceptedAt")
SELECT gen_random_uuid()::text, "id", "userId", 'owner', "createdAt", "createdAt"
FROM "Bucket"
WHERE NOT EXISTS (
  SELECT 1 FROM "BucketMember" WHERE "BucketMember"."bucketId" = "Bucket"."id" AND "BucketMember"."userId" = "Bucket"."userId"
);
