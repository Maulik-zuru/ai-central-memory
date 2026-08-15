import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { memoryService } from '../memory/memory.service';
import { curatorService } from '../memory/curator.service';
import { accessibleBucketIds, requireBucketMembership, ROLE_RANK, type BucketRole } from '../../shared/bucketAccess';

// Phase 3 (docs/Phase3_Implementation_Plan.md §6.4): a remove/combine/update suggestion is visible
// to anyone with at least viewer access to the bucket its memory lives in, and actionable
// (approve/dismiss) by anyone with editor+ — not just the user who happened to trigger the
// curator pass. "Capture" suggestions have no memory yet, so they stay scoped to whoever the
// snippet was captured for.
//
// Phase 19 (ADR-0004): `memoryIds[0]` is always the primary target (see MemorySuggestion's own
// schema comment) — the one whose bucket determines visibility, regardless of type.
async function bucketRoleFor(userId: string, suggestion: { memoryIds: string[] }): Promise<BucketRole | null> {
  const primaryId = suggestion.memoryIds[0];
  if (!primaryId) return null;
  const memory = await prisma.memory.findUnique({ where: { id: primaryId }, select: { bucketId: true } });
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
    const inScopeMemoryIds = await memoryIdsInBuckets(bucketIds);

    const suggestions = await prisma.memorySuggestion.findMany({
      where: {
        status: 'pending',
        OR: [
          { type: 'capture', userId },
          { type: { in: ['remove', 'combine', 'update'] }, memoryIds: { hasSome: inScopeMemoryIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    // Phase 19 (ADR-0004's "pending-count badge per bucket"): the frontend groups suggestions by
    // bucket to render that badge, so it needs a bucketId per suggestion rather than having to
    // resolve memoryIds[0]->bucket itself for every row. "capture" suggestions have no memory yet
    // and get null — they aren't scoped to any bucket until approved.
    const primaryIds = [...new Set(suggestions.map((s) => s.memoryIds[0]).filter((id): id is string => Boolean(id)))];
    const memories = primaryIds.length > 0
      ? await prisma.memory.findMany({ where: { id: { in: primaryIds } }, select: { id: true, bucketId: true } })
      : [];
    const bucketByMemoryId = new Map(memories.map((m) => [m.id, m.bucketId]));

    return suggestions.map((s) => ({ ...s, bucketId: bucketByMemoryId.get(s.memoryIds[0]) ?? null }));
  },

  async approve(userId: string, id: string) {
    const suggestion = await requireSuggestionAccess(userId, id, 'editor');
    if (suggestion.status !== 'pending') return suggestion;

    if (suggestion.type === 'capture') {
      await memoryService.create(userId, suggestion.draftContent ?? '', 'auto');
    } else if (suggestion.type === 'remove') {
      // memoryIds[0] is the redundant memory itself (ADR-0004) — any further ids are just the
      // "duplicate of" context the exact/fuzzy tiers attach for the reviewer, not acted on here.
      const [targetId] = suggestion.memoryIds;
      if (targetId) await memoryService.delete(userId, targetId);
    } else if (suggestion.type === 'update') {
      // A pre-Phase-19 migrated row (the old "stale"/"replaces"/"extends" types) never captured
      // rewritten content — approving one is then a safe no-op rather than a crash (see the
      // migration's own comment in prisma/migrations for why).
      const [targetId] = suggestion.memoryIds;
      if (targetId && suggestion.draftContent) {
        await memoryService.update(userId, targetId, suggestion.draftContent);
      }
    } else if (suggestion.type === 'combine') {
      if (suggestion.memoryIds.length >= 2 && suggestion.draftContent) {
        await memoryService.combine(userId, suggestion.memoryIds, suggestion.draftContent);
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

  /**
   * Bulk review for the common "a long conversation produced a pile of pending capture
   * suggestions" case — a single turn's extraction can surface several candidates at once
   * (capture.service.ts's `processCapture` loop), and a busy conversation produces one of these
   * per turn, so reviewing them one at a time is the exact friction this exists to remove.
   *
   * Reuses `approve`/`dismiss` per id rather than duplicating their type-specific write logic —
   * same per-id, not-all-or-nothing shape as chat-history's deleteMany/excludeMany, minus a
   * `rejected` array: unlike pinned conversations, no suggestion type has a "protected, needs
   * explicit override" state, so every failure is a plain `failed` (not found / no access).
   */
  async approveMany(userId: string, ids: string[]): Promise<{ approved: number; failed: string[] }> {
    const failed: string[] = [];
    let approved = 0;
    for (const id of ids) {
      try {
        await this.approve(userId, id);
        approved++;
      } catch {
        failed.push(id);
      }
    }
    return { approved, failed };
  },

  async dismissMany(userId: string, ids: string[]): Promise<{ dismissed: number; failed: string[] }> {
    const failed: string[] = [];
    let dismissed = 0;
    for (const id of ids) {
      try {
        await this.dismiss(userId, id);
        dismissed++;
      } catch {
        failed.push(id);
      }
    }
    return { dismissed, failed };
  },

  /** MemoryPlugin_Clone_Spec.md §5.2's "Check for new" manual scan action — re-runs the curator
   * across every active memory in one bucket, for whatever a fire-and-forget per-save pass hasn't
   * covered (e.g. memories created before the curator existed). */
  async scanBucket(userId: string, bucketId: string) {
    await requireBucketMembership(userId, bucketId, 'editor');
    return curatorService.scanBucket(userId, bucketId);
  },
};

async function memoryIdsInBuckets(bucketIds: string[]): Promise<string[]> {
  if (bucketIds.length === 0) return [];
  const memories = await prisma.memory.findMany({ where: { bucketId: { in: bucketIds } }, select: { id: true } });
  return memories.map((m) => m.id);
}
