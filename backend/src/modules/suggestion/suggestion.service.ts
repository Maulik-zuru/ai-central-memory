import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { memoryService } from '../memory/memory.service';

async function requireOwnedSuggestion(userId: string, id: string) {
  const suggestion = await prisma.memorySuggestion.findFirst({ where: { id, userId } });
  if (!suggestion) throw AppError.notFound('Suggestion not found');
  return suggestion;
}

export const suggestionService = {
  async listPending(userId: string) {
    return prisma.memorySuggestion.findMany({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  },

  async approve(userId: string, id: string) {
    const suggestion = await requireOwnedSuggestion(userId, id);
    if (suggestion.status !== 'pending') return suggestion;

    if (suggestion.type === 'capture') {
      await memoryService.create(userId, suggestion.draftContent ?? '', 'auto');
    } else if (suggestion.type === 'duplicate') {
      // Merge is its own explicit action for a user-initiated merge (US-MEM-06), but approving a
      // duplicate suggestion from the inbox is the same operation — keep memoryIdA, fold in B.
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
    const suggestion = await requireOwnedSuggestion(userId, id);
    if (suggestion.status !== 'pending') return suggestion;

    const updated = await prisma.memorySuggestion.update({ where: { id }, data: { status: 'dismissed' } });
    await auditService.record(userId, 'suggestion.dismiss', { type: 'MemorySuggestion', id });
    return updated;
  },
};
