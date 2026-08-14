import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';
import { categorizationBatchService, type RecategorizeResult } from './categorization-batch.service';

// Phase 20 (ADR-0006): "Type RESET" to confirm — same typed-confirmation discipline as account
// deletion (accountDeletionService.deleteAccount), enforced here so the friction is real rather
// than a client-side dialog anyone calling the API directly could skip.
const REQUIRED_RESET_CONFIRMATION = 'RESET';

// Categories are scoped per-bucket (ADR-0006) — the old per-account scoping and its "bucketId is a
// narrowing filter, not the real scope" workaround are gone; `Category.bucketId` is the real scope.
export const categoryService = {
  async list(userId: string, bucketId?: string) {
    if (bucketId) {
      await requireBucketMembership(userId, bucketId, 'viewer');
      return prisma.category.findMany({ where: { bucketId }, orderBy: { label: 'asc' } });
    }
    const bucketIds = await accessibleBucketIds(userId);
    if (bucketIds.length === 0) return [];
    return prisma.category.findMany({ where: { bucketId: { in: bucketIds } }, orderBy: { label: 'asc' } });
  },

  async listMemories(userId: string, categoryId: string, opts: { cursor?: string; limit: number }) {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw AppError.notFound('Category not found');
    await requireBucketMembership(userId, category.bucketId, 'viewer');

    const rows = await prisma.memory.findMany({
      where: { categoryId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  },

  async rename(userId: string, categoryId: string, label: string) {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw AppError.notFound('Category not found');
    await requireBucketMembership(userId, category.bucketId, 'editor');
    return prisma.category.update({ where: { id: categoryId }, data: { label } });
  },

  /**
   * MemoryPlugin_Clone_Spec.md §3.2: only the bucket owner may (re-)run Smart Memory — ADR-0001's
   * consequence for this rebuild, done as owner-only from the start rather than reusing rename's
   * editor-or-owner check. Also enforces ADR-0002's eligibility rule: never a file bucket.
   */
  async recategorize(userId: string, bucketId: string): Promise<RecategorizeResult> {
    await requireBucketMembership(userId, bucketId, 'owner');
    const bucket = await prisma.bucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw AppError.notFound('Bucket not found');
    if (bucket.type !== 'memory') {
      throw AppError.badRequest('Smart Memory only runs on memory buckets, not file buckets', 'NOT_A_MEMORY_BUCKET');
    }
    return categorizationBatchService.recategorize(bucketId);
  },

  /**
   * MemoryPlugin_Clone_Spec.md §5.1: "resetting categories is destructive and requires typing a
   * confirmation phrase." Deleting the bucket's `Category` rows detaches every memory's category
   * assignment via the existing `Memory_categoryId_fkey ... ON DELETE SET NULL` — the memories
   * themselves are never touched, only their `categoryId` pointer.
   */
  async reset(userId: string, bucketId: string, confirmation: unknown): Promise<void> {
    if (confirmation !== REQUIRED_RESET_CONFIRMATION) {
      throw AppError.badRequest(
        `Type ${REQUIRED_RESET_CONFIRMATION} to confirm resetting this bucket's Smart Memory categories.`,
        'CONFIRMATION_REQUIRED',
      );
    }
    await requireBucketMembership(userId, bucketId, 'owner');
    await prisma.category.deleteMany({ where: { bucketId } });
  },
};
