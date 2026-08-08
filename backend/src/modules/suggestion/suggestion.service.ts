import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { memoryService } from '../memory/memory.service';
import { accessibleBucketIds, ROLE_RANK, type BucketRole } from '../../shared/bucketAccess';

// Phase 3 (docs/Phase3_Implementation_Plan.md §6.4): a duplicate/stale suggestion is visible to
// anyone with at least viewer access to the bucket its memory lives in, and actionable
// (approve/dismiss) by anyone with editor+ — not just the user who happened to trigger the
// detection pass. "Capture" suggestions have no memory yet, so they stay scoped to whoever the
// snippet was captured for.
async function bucketRoleFor(userId: string, suggestion: { memoryIdA: string | null }): Promise<BucketRole | null> {
  if (!suggestion.memoryIdA) return null;
  const memory = await prisma.memory.findUnique({ where: { id: suggestion.memoryIdA }, select: { bucketId: true } });
  if (!memory) return null;
  const membership = await prisma.bucketMember.findUnique({
    where: { bucketId_userId: { bucketId: memory.bucketId, userId } },
  });
  return (membership?.role as BucketRole) ?? null;
}

async function requireSuggestionAccess(userId: string, id: string, minRole: BucketRole) {
  const suggestion = await prisma.memorySuggestion.findUnique({ where: { id } });
  if (!suggestion) throw AppError.notFound('Suggestion not found');

  if (suggestion.type === 'capture') {
    if (suggestion.userId !== userId) throw AppError.notFound('Suggestion not found');
    return suggestion;
  }

  const role = await bucketRoleFor(userId, suggestion);
  if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) throw AppError.notFound('Suggestion not found');
  return suggestion;
}

export const suggestionService = {
  async listPending(userId: string) {
    const bucketIds = await accessibleBucketIds(userId);

    return prisma.memorySuggestion.findMany({
      where: {
        status: 'pending',
        OR: [
          { type: 'capture', userId },
          { type: { in: ['duplicate', 'stale'] }, memoryIdA: { in: await memoryIdsInBuckets(bucketIds) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async approve(userId: string, id: string) {
    const suggestion = await requireSuggestionAccess(userId, id, 'editor');
    if (suggestion.status !== 'pending') return suggestion;

    if (suggestion.type === 'capture') {
      await memoryService.create(userId, suggestion.draftContent ?? '', 'auto');
    } else if (suggestion.type === 'duplicate') {
      // Merge is its own explicit action for a user-initiated merge (US-MEM-06), but approving a
      // duplicate suggestion from the inbox is the same operation — keep memoryIdA, fold in B.
      // memoryService.merge() re-checks editor access on both memories itself.
      if (suggestion.memoryIdA && suggestion.memoryIdB) {
        await memoryService.merge(userId, suggestion.memoryIdA, suggestion.memoryIdB);
      }
    } else if (suggestion.type === 'stale') {
      // The older memory (memoryIdA per stale-detection.service.ts) is marked inactive, not
      // deleted, and excluded from future retrieval (US-MEM-07 AC).
      if (suggestion.memoryIdA) {
        await prisma.memory.update({ where: { id: suggestion.memoryIdA }, data: { status: 'stale' } });
      }
    }

    const updated = await prisma.memorySuggestion.update({ where: { id }, data: { status: 'approved' } });
    await auditService.record(userId, 'suggestion.approve', { type: 'MemorySuggestion', id });
    return updated;
  },

  async dismiss(userId: string, id: string) {
    const suggestion = await requireSuggestionAccess(userId, id, 'editor');
    if (suggestion.status !== 'pending') return suggestion;

    const updated = await prisma.memorySuggestion.update({ where: { id }, data: { status: 'dismissed' } });
    await auditService.record(userId, 'suggestion.dismiss', { type: 'MemorySuggestion', id });
    return updated;
  },
};

async function memoryIdsInBuckets(bucketIds: string[]): Promise<string[]> {
  if (bucketIds.length === 0) return [];
  const memories = await prisma.memory.findMany({ where: { bucketId: { in: bucketIds } }, select: { id: true } });
  return memories.map((m) => m.id);
}
