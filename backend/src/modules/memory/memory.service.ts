import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { embeddingService } from './embedding.service';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { getLlmProvider, callProvider } from '../../shared/providers/llm.provider';
import { bucketService } from '../bucket/bucket.service';
import { ROLE_RANK, accessibleBucketIds, type BucketRole } from '../../shared/bucketAccess';
import { analyticsService } from '../intelligence/analytics.service';
import { retrievalService } from '../context/retrieval.service';

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
    mergedIntoId: memory.mergedIntoId,
    supersedesId: memory.supersedesId,
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

// Phase 15: the public API accepts a bucket by name as an alternative to its ID (this codebase
// doesn't enforce bucket-name uniqueness today — see docs/adr/0002 for the related, still-open
// bucket-type-discriminator gap — so "first match, oldest first" is a documented, deliberate
// choice here, not a silent assumption).
async function resolveBucketIdByName(userId: string, bucketName: string): Promise<string> {
  const memberships = await prisma.bucketMember.findMany({
    where: { userId, role: { in: ['editor', 'owner'] } },
    include: { bucket: true },
    orderBy: { bucket: { createdAt: 'asc' } },
  });
  const match = memberships.find((m) => m.bucket.name.toLowerCase() === bucketName.toLowerCase());
  if (!match) throw AppError.notFound(`No editable bucket named "${bucketName}"`, 'BUCKET_NOT_FOUND');
  return match.bucketId;
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

    // US-MEM-05 / MemoryPlugin_Clone_Spec.md §5.7: image memories aren't supported inside shared
    // buckets yet — checked here, not just left as an unstated gap, so a memory saved into a
    // bucket that's shared *right now* never becomes visible to collaborators through a code path
    // nobody decided should allow that.
    const memberCount = await prisma.bucketMember.count({ where: { bucketId: targetBucketId } });
    if (memberCount > 1) {
      throw AppError.badRequest(
        'Image memories aren\'t supported in shared buckets yet. Save it to a bucket only you have access to.',
        'IMAGE_NOT_SUPPORTED_IN_SHARED_BUCKET',
      );
    }

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

  async list(userId: string, opts: { cursor?: string; limit: number; q?: string; bucketId?: string; type?: 'text' | 'image' }) {
    const bucketIds = opts.bucketId
      ? [(await requireBucketMembership(userId, opts.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);

    const where = {
      bucketId: { in: bucketIds },
      status: 'active',
      ...(opts.q ? { content: { contains: opts.q, mode: 'insensitive' as const } } : {}),
      ...(opts.type ? { type: opts.type } : {}),
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

  // Phase 16 (US-INT-03a/b): the same semantic ranking the `memoryos_search_memories` MCP tool
  // needs, pulled out here so both the remote (in-process) tool and this REST endpoint — which
  // the local MCP server package calls, since it has no direct Prisma access — call one
  // implementation rather than two independently-drifting copies of the same ranking logic.
  async search(userId: string, opts: { query: string; bucketId?: string; limit: number }) {
    const bucketIds = opts.bucketId
      ? [(await requireBucketMembership(userId, opts.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);

    const provider = getLlmProvider();
    const embedding = await callProvider(
      () => provider.embed(opts.query),
      'Could not search your memories right now — the AI provider is temporarily unavailable.',
    );
    const rows = await retrievalService.scoreCandidates(bucketIds, embedding);
    const ranked = [...rows].sort((a, b) => a.distance - b.distance);

    const hasMore = ranked.length > opts.limit;
    return { items: hasMore ? ranked.slice(0, opts.limit) : ranked, hasMore };
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

  /** Shared by the single-memory and bulk branches of the v2 update endpoint — one place that
   * decides what a caller-supplied `{bucketId}` or `{bucketName}` actually resolves to. */
  async resolveBucketId(userId: string, target: { bucketId?: string; bucketName?: string }): Promise<string> {
    if (target.bucketId) {
      return (await requireBucketMembership(userId, target.bucketId, 'editor')).bucketId;
    }
    return resolveBucketIdByName(userId, target.bucketName!);
  },

  /**
   * Phase 15 (US-INT-06, MemoryPlugin_Clone_Spec.md §6): bulk move, and genuinely all-or-nothing —
   * every requested ID is resolved and access-checked BEFORE any write happens, so a batch with one
   * bad ID moves zero memories, not 99 of 100. Mirrors `US-ACC-06`'s account-deletion cascade in
   * spirit: validate everything first, only then touch the database.
   */
  async bulkMove(
    userId: string,
    memoryIds: string[],
    target: { bucketId?: string; bucketName?: string },
  ): Promise<{ movedCount: number }> {
    const targetBucketId = await this.resolveBucketId(userId, target);

    const accessible = await prisma.bucketMember.findMany({
      where: { userId, role: { in: ['editor', 'owner'] } },
      select: { bucketId: true },
    });
    const editableBucketIds = new Set(accessible.map((m) => m.bucketId));

    const found = await prisma.memory.findMany({
      where: { id: { in: memoryIds } },
      select: { id: true, bucketId: true, status: true },
    });
    const byId = new Map(found.map((m) => [m.id, m]));

    const rejectedIds = memoryIds.filter((id) => {
      const memory = byId.get(id);
      return !memory || memory.status === 'deleted' || !editableBucketIds.has(memory.bucketId);
    });

    if (rejectedIds.length > 0) {
      throw AppError.notFound(
        `${rejectedIds.length} of ${memoryIds.length} memories could not be resolved or aren't editable by you — nothing was moved.`,
        'MEMORIES_NOT_FOUND',
        { rejectedIds },
      );
    }

    await prisma.memory.updateMany({ where: { id: { in: memoryIds } }, data: { bucketId: targetBucketId } });
    await auditService.record(userId, 'memory.bulkMove', { type: 'Bucket', id: targetBucketId });
    return { movedCount: memoryIds.length };
  },

  /**
   * Deliberately NOT all-or-nothing (contrast with bulkMove above) — a destructive action where
   * one inaccessible ID shouldn't block deleting the rest the caller does own
   * (MemoryPlugin_Clone_Spec.md §6: "response reports deleted/failed counts").
   */
  async bulkDelete(userId: string, memoryIds: string[]): Promise<{ deleted: number; failed: string[] }> {
    const failed: string[] = [];
    let deleted = 0;
    for (const id of memoryIds) {
      try {
        await this.delete(userId, id);
        deleted++;
      } catch {
        failed.push(id);
      }
    }
    return { deleted, failed };
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
      // Phase 14: the absorbed memory keeps a `mergedIntoId` pointer rather than just a status
      // flip — "merged" alone tells you it's gone, not where it went.
      prisma.memory.update({ where: { id: mergeId }, data: { status: 'merged', mergedIntoId: keepId } }),
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
