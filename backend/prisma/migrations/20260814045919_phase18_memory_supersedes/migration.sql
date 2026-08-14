-- Phase 18 (ADR-0003 "supersedes relation"): the DROP INDEX statements Prisma auto-generated
-- ahead of this file's real change, plus the unrelated "ALTER COLUMN contentTsv DROP DEFAULT"
-- (a Prisma model-drift artifact, not an actual change this migration is making), have been
-- removed. Same recurring trap documented in 20260808190000_restore_vector_indexes/migration.sql
-- and 20260814044310_phase18_memory_content_trigram/migration.sql — read every future generated
-- migration.sql for this before committing it.

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "supersedesId" TEXT;

-- CreateIndex
CREATE INDEX "Memory_supersedesId_idx" ON "Memory"("supersedesId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
