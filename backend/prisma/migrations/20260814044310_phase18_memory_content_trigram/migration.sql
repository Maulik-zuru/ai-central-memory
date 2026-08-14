-- Phase 18 (§7.4 "layered duplicate matching"): the fuzzy-match tier between the cheap exact-string
-- check and the existing embedding-threshold check, per docs/MemoryPlugin_Parity_Implementation_Plan.md.
--
-- Every DROP INDEX statement Prisma auto-generated ahead of this file's real change, plus the
-- unrelated "ALTER COLUMN contentTsv DROP DEFAULT" (a Prisma model-drift artifact, not an actual
-- change this migration is making), have been removed. Same recurring trap documented in
-- 20260808190000_restore_vector_indexes/migration.sql and 20260813102643_phase17_message_chunk_tsvector
-- /migration.sql: Prisma's schema language cannot describe the HNSW/GIN indexes and generated
-- columns already in this database, so every migration generated after they exist comes out with
-- statements that would silently undo them — read every future generated migration.sql for this
-- before committing it.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS "memory_content_trgm_idx"
  ON "Memory" USING GIN ("content" gin_trgm_ops);
