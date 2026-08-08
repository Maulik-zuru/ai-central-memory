import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { embeddingService } from './embedding.service';
import { getStorageProvider } from '../../shared/providers/storage.provider';

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

async function getDefaultBucketId(userId: string): Promise<string> {
  const bucket = await prisma.bucket.findFirst({ where: { userId, isDefault: true } });
  if (bucket) return bucket.id;
  // Defensive fallback for any account that predates the default-bucket backfill/registration
  // hook — should not happen in practice, but a missing bucket must never silently 500 a save.
  const created = await prisma.bucket.create({ data: { userId, name: 'Personal', isDefault: true } });
  return created.id;
}

async function requireOwned(userId: string, id: string) {
  const memory = await prisma.memory.findFirst({ where: { id, userId, status: { not: 'deleted' } } });
  if (!memory) throw AppError.notFound('Memory not found');
  return memory;
}

export const memoryService = {
  async create(userId: string, content: string, source: 'manual' | 'one_click' | 'auto' = 'manual') {
    const bucketId = await getDefaultBucketId(userId);
    const memory = await prisma.memory.create({
      data: {
        userId,
        bucketId,
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
    return toPublic(memory);
  },

  async createImage(userId: string, file: { buffer: Buffer; filename: string; mimeType: string }, caption?: string) {
    const bucketId = await getDefaultBucketId(userId);
    const stored = await getStorageProvider().put(file.buffer, file.filename);
    const content = caption?.trim() || file.filename;

    const memory = await prisma.memory.create({
      data: {
        userId,
        bucketId,
        type: 'image',
        content,
        imageUrl: stored.url,
        source: 'manual',
        versions: { create: { content, changedBy: userId, changeType: 'create' } },
      },
    });

    void embeddingService.process(memory.id, userId, content);
    await auditService.record(userId, 'memory.create', { type: 'Memory', id: memory.id });
    return toPublic(memory);
  },

  async oneClickSave(userId: string, content: string) {
    return this.create(userId, content, 'one_click');
  },

  async list(userId: string, opts: { cursor?: string; limit: number; q?: string }) {
    const where = {
      userId,
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
    return toPublic(await requireOwned(userId, id));
  },

  async update(userId: string, id: string, content: string) {
    await requireOwned(userId, id);
    const updated = await prisma.memory.update({
      where: { id },
      data: { content, versions: { create: { content, changedBy: userId, changeType: 'edit' } } },
    });

    void embeddingService.process(id, userId, content);
    await auditService.record(userId, 'memory.update', { type: 'Memory', id });
    return toPublic(updated);
  },

  async delete(userId: string, id: string) {
    await requireOwned(userId, id);
    // Soft delete: excluded from list()/get() immediately (requireOwned and list() both filter on
    // status), never hard-removed, so a version history and audit trail survive (US-MEM-04 AC).
    await prisma.memory.update({ where: { id }, data: { status: 'deleted' } });
    await auditService.record(userId, 'memory.delete', { type: 'Memory', id });
  },

  async merge(userId: string, keepId: string, mergeId: string) {
    if (keepId === mergeId) throw AppError.badRequest('Cannot merge a memory with itself');
    const [keep, merge] = await Promise.all([requireOwned(userId, keepId), requireOwned(userId, mergeId)]);

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
    await requireOwned(userId, memoryId);
    return prisma.memoryVersion.findMany({ where: { memoryId }, orderBy: { createdAt: 'asc' } });
  },
};
