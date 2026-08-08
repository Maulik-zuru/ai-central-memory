import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import type { BucketRole } from '../../shared/bucketAccess';

// Categories are scoped per-account (creator) — Phase4_Implementation_Plan.md §5.1. Renaming
// never touches centroid or memoryCount so it can't break future categorization for that cluster.
export const categoryService = {
  async list(userId: string) {
    return prisma.category.findMany({
      where: { userId },
      orderBy: { label: 'asc' },
    });
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
