-- Phase 14: merged-memory trail (docs/MemoryPlugin_Parity_Implementation_Plan.md Phase 14).
--
-- NOTE: `prisma migrate dev` initially emitted four `DROP INDEX ..._hnsw_idx` statements ahead of
-- this change, for the same reason documented in 20260808190000_restore_vector_indexes/migration.sql
-- (Prisma cannot see indexes on `Unsupported("vector(...)")` columns and treats them as drift on
-- every subsequent diff). Removed here per that migration's own instruction to check for exactly
-- this before committing.

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "mergedIntoId" TEXT;

-- CreateIndex
CREATE INDEX "Memory_mergedIntoId_idx" ON "Memory"("mergedIntoId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
