import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { requireBucketMembership, type BucketRole } from '../../shared/bucketAccess';

// Categories are scoped per-account (creator) — Phase4_Implementation_Plan.md §5.1. Renaming
// never touches centroid or memoryCount so it can't break future categorization for that cluster.
export const categoryService = {
  // Phase 16 (US-INT-03a/b): `bucketId` is an optional narrowing filter, not a second scope —
  // categories remain account-scoped (see this module's own comment above); "bucket-scoped
  // categories" proper is Phase 20's job. This is the same reduced filter
  // `memoryos_list_bucket_categories` already shipped with, now living here so the REST endpoint
  // the local MCP server calls and the in-process remote tool share one implementation.
  async list(userId: string, bucketId?: string) {
    if (bucketId) await requireBucketMembership(userId, bucketId, 'viewer');
    const categories = await prisma.category.findMany({
      where: { userId },
      orderBy: { label: 'asc' },
    });
    if (!bucketId) return categories;

    const withMemoriesInBucket = await prisma.category.findMany({
      where: { id: { in: categories.map((c) => c.id) }, memories: { some: { bucketId } } },
      select: { id: true },
    });
    const matchingIds = new Set(withMemoriesInBucket.map((c) => c.id));
    return categories.filter((c) => matchingIds.has(c.id));
  },

  async listMemories(userId: string, categoryId: string, opts: { cursor?: string; limit: number }) {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.userId !== userId) throw AppError.notFound('Category not found');

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

    if (category.userId !== userId) {
      // A shared-bucket collaborator can rename a category they didn't create only if they hold
      // editor+ on at least one memory currently in it — the same edit-rights check that gates
      // any other content change, not a separate category-ownership rule (§5.1).
      const editableMember = await prisma.memory.findFirst({
        where: {
          categoryId,
          status: { not: 'deleted' },
          bucket: { members: { some: { userId, role: { in: ['editor', 'owner'] as BucketRole[] } } } },
        },
      });
      if (!editableMember) throw AppError.forbidden('You do not have access to this category', 'CATEGORY_ACCESS_DENIED');
    }

    return prisma.category.update({ where: { id: categoryId }, data: { label } });
  },
};
