-- Restores the HNSW vector indexes added in 20260808180000_phase12_vector_indexes.
--
-- WHY THIS EXISTS — and the trap every future migration on this schema must avoid:
--
-- These indexes are created in raw SQL because they sit on `Unsupported("vector(1536)")` columns
-- that Prisma's schema language cannot describe. Prisma therefore does not know they exist, and
-- `prisma migrate dev` treats them as drift: the very next migration generated after them
-- (20260808173630_phase12_has_seen_tour, a one-line ALTER TABLE adding a boolean) was emitted with
-- four DROP INDEX statements at the top, silently undoing the whole Phase 12 indexing effort.
--
-- IF NOT EXISTS makes this file idempotent: it repairs a database that ran the bad version, and is
-- a no-op on a fresh one that never lost them.
--
-- BEFORE COMMITTING ANY FUTURE `prisma migrate dev` OUTPUT: read the generated migration.sql and
-- delete any `DROP INDEX ..._hnsw_idx` lines Prisma added. The vector-index test in
-- tests/vector-index.test.ts fails loudly if these ever go missing again, so this is caught by CI
-- rather than by a latency regression noticed months later.

CREATE INDEX IF NOT EXISTS "memory_embedding_hnsw_idx"
  ON "Memory" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "message_chunk_embedding_hnsw_idx"
  ON "MessageChunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "file_chunk_embedding_hnsw_idx"
  ON "FileChunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "category_centroid_hnsw_idx"
  ON "Category" USING hnsw (centroid vector_cosine_ops);
