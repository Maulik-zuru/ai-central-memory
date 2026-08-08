-- Phase 12: vector index tuning (docs/Phase12_Implementation_Plan.md §4/§5.1).
--
-- Every similarity query in the codebase (retrieval.service, chat-search.service,
-- file-search.service, ask.service, categorization.service) ran an unindexed sequential scan
-- before this migration. Correct, but linear in table size.
--
-- HNSW rather than the ivfflat the plan originally specified. The deciding reason is structural,
-- not a benchmark preference: an ivfflat index computes its cluster centroids from the rows
-- present AT BUILD TIME. Migrations run against an empty (or near-empty) table, so an ivfflat
-- index created here would be built from no data and would have to be manually REINDEXed later to
-- be worth anything — a silent trap where the index exists, queries "use" it, and recall is poor.
-- HNSW builds its graph incrementally as rows are inserted, so it is correct from an empty table
-- onward. pgvector 0.6.0 (the version this database runs) supports it.
--
-- m / ef_construction are left at pgvector's defaults (16 / 64), which are the documented
-- general-purpose starting point. Like every other threshold in this codebase they are a first
-- calibrated guess, to be re-tuned against real recall measurements once production row counts
-- exist — not a settled constant.
--
-- vector_cosine_ops matches the `<=>` operator every query in the codebase uses. An index built
-- with a different opclass would simply never be chosen by the planner.

CREATE INDEX IF NOT EXISTS "memory_embedding_hnsw_idx"
  ON "Memory" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "message_chunk_embedding_hnsw_idx"
  ON "MessageChunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "file_chunk_embedding_hnsw_idx"
  ON "FileChunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "category_centroid_hnsw_idx"
  ON "Category" USING hnsw (centroid vector_cosine_ops);
