-- Phase 16 (US-INT-03b): backing model for the `export_conversation` MCP tool.
--
-- NOTE: `prisma migrate dev` initially emitted four `DROP INDEX ..._hnsw_idx` statements ahead of
-- this change, for the same reason documented in 20260808190000_restore_vector_indexes/migration.sql
-- and repeated in every migration since — Prisma cannot see indexes on
-- `Unsupported("vector(...)")` columns and treats them as drift on every diff. Removed here per
-- that migration's own instruction to check for exactly this before committing.

-- CreateTable
CREATE TABLE "McpConversationExport" (
    "id" TEXT NOT NULL,
    "downloadKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpConversationExport_pkey" PRIMARY KEY ("id")
);
