-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "graphProcessedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "graphProcessedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnowledgeGraphNode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraphEdge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceMemoryId" TEXT,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageAnalyticsSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "memoriesCreated" INTEGER NOT NULL DEFAULT 0,
    "askQueries" INTEGER NOT NULL DEFAULT 0,
    "syncsCompleted" INTEGER NOT NULL DEFAULT 0,
    "tokensSaved" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageAnalyticsSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripePaymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "refundEligibleUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeGraphNode_userId_idx" ON "KnowledgeGraphNode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGraphNode_userId_normalizedName_type_key" ON "KnowledgeGraphNode"("userId", "normalizedName", "type");

-- CreateIndex
CREATE INDEX "KnowledgeGraphEdge_userId_idx" ON "KnowledgeGraphEdge"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeGraphEdge_fromNodeId_idx" ON "KnowledgeGraphEdge"("fromNodeId");

-- CreateIndex
CREATE INDEX "KnowledgeGraphEdge_toNodeId_idx" ON "KnowledgeGraphEdge"("toNodeId");

-- CreateIndex
CREATE INDEX "UsageAnalyticsEvent_userId_type_createdAt_idx" ON "UsageAnalyticsEvent"("userId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageAnalyticsSummary_userId_period_key" ON "UsageAnalyticsSummary"("userId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentId_key" ON "Payment"("stripePaymentId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_stripeEventId_key" ON "ProcessedWebhookEvent"("stripeEventId");

-- AddForeignKey
ALTER TABLE "KnowledgeGraphNode" ADD CONSTRAINT "KnowledgeGraphNode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "KnowledgeGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "KnowledgeGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_sourceMemoryId_fkey" FOREIGN KEY ("sourceMemoryId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGraphEdge" ADD CONSTRAINT "KnowledgeGraphEdge_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageAnalyticsEvent" ADD CONSTRAINT "UsageAnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageAnalyticsSummary" ADD CONSTRAINT "UsageAnalyticsSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
