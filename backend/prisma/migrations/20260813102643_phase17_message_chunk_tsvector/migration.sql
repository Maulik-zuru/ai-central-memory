-- Phase 17 (US-ARC-07): the keyword half of hybrid search (MemoryPlugin_Clone_Spec.md §7.3).
--
-- The four DROP INDEX statements Prisma auto-generated ahead of this file's real change have been
-- removed. This is the same trap documented in 20260808190000_restore_vector_indexes/migration.sql:
-- Prisma's schema language cannot describe the HNSW indexes on `Unsupported("vector(1536)")`
-- columns, so every migration generated after those indexes exist is emitted with DROP INDEX
-- statements for them — read every future generated migration.sql for this before committing it.
--
-- `contentTsv` is GENERATED ALWAYS ... STORED rather than a plain column Prisma would need to
-- populate at write time: Postgres keeps it in sync with `content` itself, so it can never drift
-- the way a manually-maintained column (updated from application code on every insert) could.

ALTER TABLE "MessageChunk"
  ADD COLUMN "contentTsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

CREATE INDEX IF NOT EXISTS "message_chunk_content_tsv_gin_idx"
  ON "MessageChunk" USING GIN ("contentTsv");
