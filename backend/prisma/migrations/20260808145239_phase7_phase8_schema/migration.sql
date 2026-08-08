-- CreateTable
CREATE TABLE "AskConversation" (
    "id" TEXT NOT NULL,
    "bucketId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mode" TEXT,
    "citations" JSONB,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionPairingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskConversation_userId_idx" ON "AskConversation"("userId");

-- CreateIndex
CREATE INDEX "AskConversation_bucketId_idx" ON "AskConversation"("bucketId");

-- CreateIndex
CREATE INDEX "AskMessage_conversationId_idx" ON "AskMessage"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AskMessage_conversationId_position_key" ON "AskMessage"("conversationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionPairingCode_code_key" ON "ExtensionPairingCode"("code");

-- CreateIndex
CREATE INDEX "ExtensionPairingCode_code_idx" ON "ExtensionPairingCode"("code");

-- AddForeignKey
ALTER TABLE "AskConversation" ADD CONSTRAINT "AskConversation_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskConversation" ADD CONSTRAINT "AskConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskMessage" ADD CONSTRAINT "AskMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AskConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionPairingCode" ADD CONSTRAINT "ExtensionPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
