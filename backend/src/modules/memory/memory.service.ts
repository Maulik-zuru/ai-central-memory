import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { embeddingService } from './embedding.service';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { bucketService } from '../bucket/bucket.service';
import { ROLE_RANK, accessibleBucketIds, type BucketRole } from '../../shared/bucketAccess';
import { analyticsService } from '../intelligence/analytics.service';

type MemoryRecord = Awaited<ReturnType<typeof prisma.memory.findFirstOrThrow>>;

function toPublic(memory: MemoryRecord) {
  return {
    id: memory.id,
    bucketId: memory.bucketId,
    type: memory.type,
    content: memory.content,
    imageUrl: memory.imageUrl,
    source: memory.source,
    status: memory.status,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

// Phase 3 retrofit (docs/Phase3_Implementation_Plan.md §6.4): a memory's accessibility is
// governed entirely by BucketMember role on its bucket, never by who created it — the whole
// point of a shared bucket is that an editor's memories are visible/editable by other members.
async function requireBucketMembership(userId: string, bucketId: string, minRole: BucketRole) {
  const membership = await prisma.bucketMember.findUnique({ where: { bucketId_userId: { bucketId, userId } } });
  if (!membership || ROLE_RANK[membership.role as BucketRole] < ROLE_RANK[minRole]) {
    throw AppError.forbidden('You do not have access to this bucket', 'BUCKET_ACCESS_DENIED');
  }
  return membership;
}

async function requireAccess(userId: string, id: string, minRole: BucketRole) {
  const memory = await prisma.memory.findFirst({ where: { id, status: { not: 'deleted' } } });
  if (!memory) throw AppError.notFound('Memory not found');
  await requireBucketMembership(userId, memory.bucketId, minRole);
  return memory;
}

export const memoryService = {
  async create(userId: string, content: string, source: 'manual' | 'one_click' | 'auto' = 'manual', bucketId?: string) {
    const targetBucketId = bucketId
      ? (await requireBucketMembership(userId, bucketId, 'editor')).bucketId
      : await bucketService.getDefaultBucketId(userId);

    const memory = await prisma.memory.create({
      data: {
        userId,
        bucketId: targetBucketId,
        type: 'text',
        content,
        source,
        versions: { create: { content, changedBy: userId, changeType: 'create' } },
      },
    });

    // Fire-and-forget: the save responds before this resolves (US-MEM-01 AC). See
    // embedding.service.ts for why this is a plain async call and not a real queue yet.
    void embeddingService.process(memory.id, userId, content);
    await auditService.record(userId, 'memory.create', { type: 'Memory', id: memory.id });
    analyticsService.record(userId, 'memory_created');
    return toPublic(memory);
  },

  async createImage(
    userId: string,
    file: { buffer: Buffer; filename: string; mimeType: string },
    caption?: string,
    bucketId?: string,
  ) {
    const targetBucketId = bucketId
      ? (await requireBucketMembership(userId, bucketId, 'editor')).bucketId
      : await bucketService.getDefaultBucketId(userId);
    const stored = await getStorageProvider().put(file.buffer, file.filename);
    const content = caption?.trim() || file.filename;

    const memory = await prisma.memory.create({
      data: {
        userId,
        bucketId: targetBucketId,
        type: 'image',
        content,
        imageUrl: stored.url,
        source: 'manual',
        versions: { create: { content, changedBy: userId, changeType: 'create' } },
      },
    });

    void embeddingService.process(memory.id, userId, content);
    await auditService.record(userId, 'memory.create', { type: 'Memory', id: memory.id });
    analyticsService.record(userId, 'memory_created');
    return toPublic(memory);
  },

  async oneClickSave(userId: string, content: string) {
    return this.create(userId, content, 'one_click');
  },

  async list(userId: string, opts: { cursor?: string; limit: number; q?: string; bucketId?: string }) {
    const bucketIds = opts.bucketId
      ? [(await requireBucketMembership(userId, opts.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);

    const where = {
      bucketId: { in: bucketIds },
      status: 'active',
      ...(opts.q ? { content: { contains: opts.q, mode: 'insensitive' as const } } : {}),
    };

    const rows = await prisma.memory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    return {
      items: page.map(toPublic),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  },

  async get(userId: string, id: string) {
    return toPublic(await requireAccess(userId, id, 'viewer'));
  },

  async update(userId: string, id: string, content: string) {
    await requireAccess(userId, id, 'editor');
    const updated = await prisma.memory.update({
      where: { id },
      // Attributed to the acting user, who may be a collaborator, not necessarily the memory's
      // original creator (US-ORG-04 AC: an editor's change is attributed to that member).
      data: { content, versions: { create: { content, changedBy: userId, changeType: 'edit' } } },
    });

    void embeddingService.process(id, userId, content);
    await auditService.record(userId, 'memory.update', { type: 'Memory', id });
    return toPublic(updated);
  },

  async delete(userId: string, id: string) {
    await requireAccess(userId, id, 'editor');
    // Soft delete: excluded from list()/get() immediately (requireAccess and list() both filter
    // on status), never hard-removed, so a version history and audit trail survive (US-MEM-04 AC).
    await prisma.memory.update({ where: { id }, data: { status: 'deleted' } });
    await auditService.record(userId, 'memory.delete', { type: 'Memory', id });
  },

  async move(userId: string, id: string, bucketId: string) {
    await requireAccess(userId, id, 'editor');
    await requireBucketMembership(userId, bucketId, 'editor');
    const updated = await prisma.memory.update({ where: { id }, data: { bucketId } });
    await auditService.record(userId, 'memory.move', { type: 'Memory', id });
    return toPublic(updated);
  },

  async merge(userId: string, keepId: string, mergeId: string) {
    if (keepId === mergeId) throw AppError.badRequest('Cannot merge a memory with itself');
    const [keep, merge] = await Promise.all([
      requireAccess(userId, keepId, 'editor'),
      requireAccess(userId, mergeId, 'editor'),
    ]);

    const mergedContent = `${keep.content}\n\n${merge.content}`;

    await prisma.$transaction([
      // Both originals' version histories survive under the merged record (US-MEM-06 AC).
      prisma.memoryVersion.updateMany({ where: { memoryId: mergeId }, data: { memoryId: keepId } }),
      prisma.memory.update({
        where: { id: keepId },
        data: { content: mergedContent, versions: { create: { content: mergedContent, changedBy: 'system', changeType: 'merge' } } },
      }),
      prisma.memory.update({ where: { id: mergeId }, data: { status: 'merged' } }),
    ]);

    void embeddingService.process(keepId, userId, mergedContent);
    await auditService.record(userId, 'memory.merge', { type: 'Memory', id: keepId });
    return this.get(userId, keepId);
  },

  async listVersions(userId: string, memoryId: string) {
    await requireAccess(userId, memoryId, 'viewer');
    return prisma.memoryVersion.findMany({ where: { memoryId }, orderBy: { createdAt: 'asc' } });
  },
};
