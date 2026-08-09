-- Phase 13: Desktop agent (macOS + Windows).
-- See docs/Phase13_DesktopAgent_Implementation_Plan.md §6.1.
--
-- The ExtensionPairingCode table is now shared with the desktop agent. The Prisma model was
-- renamed to DevicePairingCode with @@map("ExtensionPairingCode"), so this is a column add — no
-- table rename, no data move, no downtime.
--
-- NOTE (vector-index trap): this file is hand-written. `prisma migrate dev` would have emitted
-- DROP INDEX statements for the four HNSW indexes on Unsupported("vector(1536)") columns, because
-- it cannot see them and reads them as drift. See 20260808190000_restore_vector_indexes.

-- AlterTable
ALTER TABLE "ExtensionPairingCode" ADD COLUMN "client" TEXT NOT NULL DEFAULT 'extension';

-- CreateTable
CREATE TABLE "DesktopAgentDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "apiKeyId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopAgentDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesktopAgentDevice_apiKeyId_key" ON "DesktopAgentDevice"("apiKeyId");

-- CreateIndex
CREATE INDEX "DesktopAgentDevice_userId_idx" ON "DesktopAgentDevice"("userId");

-- AddForeignKey
ALTER TABLE "DesktopAgentDevice" ADD CONSTRAINT "DesktopAgentDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
