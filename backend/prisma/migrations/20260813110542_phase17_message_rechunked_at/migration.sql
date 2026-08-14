-- The four DROP INDEX statements Prisma auto-generated ahead of this file's real change (plus a
-- fifth, for the contentTsv GIN index this same phase's earlier migration added) have been
-- removed — the same trap documented in 20260808190000_restore_vector_indexes/migration.sql:
-- Prisma's schema language cannot describe HNSW/GIN indexes on Unsupported-typed columns, so every
-- migration generated after they exist is emitted with DROP INDEX statements for them.
--
-- Also removed: a spurious `ALTER TABLE "MessageChunk" ALTER COLUMN "contentTsv" DROP DEFAULT`
-- Prisma generated from misreading the GENERATED ALWAYS AS ... STORED column as if it had an
-- ordinary default to reconcile — there's nothing to drop, and a generated column can't take this
-- ALTER form at all.

ALTER TABLE "Message" ADD COLUMN "rechunkedAt" TIMESTAMP(3);
