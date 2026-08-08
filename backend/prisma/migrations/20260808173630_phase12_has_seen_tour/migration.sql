-- DropIndex
DROP INDEX "category_centroid_hnsw_idx";

-- DropIndex
DROP INDEX "file_chunk_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "memory_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "message_chunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hasSeenTour" BOOLEAN NOT NULL DEFAULT false;
