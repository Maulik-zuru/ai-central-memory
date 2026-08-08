-- AlterTable
ALTER TABLE "Bucket" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "smartMemoryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "BucketMember" (
    "id" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "BucketMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BucketInvite" (
    "id" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucketInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "centroid" vector(1536),
    "memoryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BucketMember_userId_idx" ON "BucketMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BucketMember_bucketId_userId_key" ON "BucketMember"("bucketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BucketInvite_tokenHash_key" ON "BucketInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "BucketInvite_bucketId_idx" ON "BucketInvite"("bucketId");

-- CreateIndex
CREATE INDEX "BucketInvite_email_idx" ON "BucketInvite"("email");

-- CreateIndex
CREATE INDEX "Category_userId_idx" ON "Category"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_label_key" ON "Category"("userId", "label");

-- CreateIndex
CREATE INDEX "Bucket_parentId_idx" ON "Bucket"("parentId");

-- CreateIndex
CREATE INDEX "Memory_categoryId_idx" ON "Memory"("categoryId");

-- AddForeignKey
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucketMember" ADD CONSTRAINT "BucketMember_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucketMember" ADD CONSTRAINT "BucketMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BucketInvite" ADD CONSTRAINT "BucketInvite_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
