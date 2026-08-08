import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { ROLE_RANK, type BucketRole } from '../../shared/bucketAccess';

// Services stay self-defending regardless of caller (codebase-design: a deep module doesn't trust
// that some route middleware already validated everything) — routes also apply
// requireBucketRole() for the primary :bucketId so a bad request is rejected before this even
// runs, but this check is what actually protects e.g. the parentId cross-reference below, which
// route-level middleware has no way to know about.
async function requireMembership(userId: string, bucketId: string, minRole: BucketRole) {
  const membership = await prisma.bucketMember.findUnique({ where: { bucketId_userId: { bucketId, userId } } });
  if (!membership || ROLE_RANK[membership.role as BucketRole] < ROLE_RANK[minRole]) {
    throw AppError.forbidden('You do not have access to this bucket', 'BUCKET_ACCESS_DENIED');
  }
  return membership;
}

async function assertNoCycle(bucketId: string, candidateParentId: string) {
  let cursor: string | null = candidateParentId;
  while (cursor) {
    if (cursor === bucketId) throw AppError.badRequest('A bucket cannot be nested under itself', 'BUCKET_CYCLE');
    const parent: { parentId: string | null } | null = await prisma.bucket.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

export const bucketService = {
  async create(userId: string, name: string, parentId?: string) {
    if (parentId) {
      // Creating a bucket nested under another requires at least editor rights on the parent —
      // otherwise anyone could graft a bucket into someone else's tree.
      await requireMembership(userId, parentId, 'editor');
    }

    const bucket = await prisma.$transaction(async (tx) => {
      const created = await tx.bucket.create({ data: { userId, name, parentId } });
      await tx.bucketMember.create({ data: { bucketId: created.id, userId, role: 'owner', acceptedAt: new Date() } });
      return created;
    });

    await auditService.record(userId, 'bucket.create', { type: 'Bucket', id: bucket.id });
    return bucket;
  },

  async rename(userId: string, bucketId: string, name: string) {
    await requireMembership(userId, bucketId, 'owner');
    const bucket = await prisma.bucket.update({ where: { id: bucketId }, data: { name } });
    await auditService.record(userId, 'bucket.rename', { type: 'Bucket', id: bucketId });
    return bucket;
  },

  async move(userId: string, bucketId: string, parentId: string | null) {
    await requireMembership(userId, bucketId, 'owner');
    if (parentId) {
      await requireMembership(userId, parentId, 'editor');
      await assertNoCycle(bucketId, parentId);
    }
    const bucket = await prisma.bucket.update({ where: { id: bucketId }, data: { parentId } });
    await auditService.record(userId, 'bucket.move', { type: 'Bucket', id: bucketId });
    return bucket;
  },

  async delete(userId: string, bucketId: string) {
    const bucket = await prisma.bucket.findUnique({ where: { id: bucketId } });
    if (!bucket) throw AppError.notFound('Bucket not found');
    await requireMembership(userId, bucketId, 'owner');

    if (bucket.isDefault) {
      throw AppError.badRequest('The default bucket cannot be deleted', 'CANNOT_DELETE_DEFAULT');
    }
    const childCount = await prisma.bucket.count({ where: { parentId: bucketId } });
    if (childCount > 0) {
      throw AppError.badRequest('Move or delete this bucket\'s sub-buckets first', 'BUCKET_HAS_CHILDREN');
    }

    await prisma.bucket.delete({ where: { id: bucketId } });
    await auditService.record(userId, 'bucket.delete', { type: 'Bucket', id: bucketId });
  },

  /** The tree of every bucket the caller is a member of, with their role attached. A bucket whose
   * true parent the caller can't see is reported as top-level for them — they should never learn
   * a parent bucket exists just because they can see one of its children. */
  async list(userId: string) {
    const memberships = await prisma.bucketMember.findMany({
      where: { userId },
      include: { bucket: true },
      orderBy: { bucket: { createdAt: 'asc' } },
    });

    const visibleIds = new Set(memberships.map((m) => m.bucketId));
    return memberships.map((m) => ({
      id: m.bucket.id,
      name: m.bucket.name,
      isDefault: m.bucket.isDefault,
      parentId: m.bucket.parentId && visibleIds.has(m.bucket.parentId) ? m.bucket.parentId : null,
      role: m.role,
      createdAt: m.bucket.createdAt,
    }));
  },

  async getDefaultBucketId(userId: string): Promise<string> {
    const bucket = await prisma.bucket.findFirst({ where: { userId, isDefault: true } });
    if (bucket) return bucket.id;
    // Defensive fallback — should not happen given registration always creates one (Phase 1/2).
    const created = await this.create(userId, 'Personal');
    await prisma.bucket.update({ where: { id: created.id }, data: { isDefault: true } });
    return created.id;
  },
};
