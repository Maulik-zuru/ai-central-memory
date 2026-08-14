import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';

function toPublic(conversation: {
  id: string;
  bucketId: string;
  platform: string;
  title: string;
  summary: string | null;
  messageCount: number;
  status: string;
  errorReason: string | null;
  importedAt: Date;
  lastSyncedAt: Date;
}) {
  return conversation;
}

export const conversationService = {
  async list(userId: string, opts: { cursor?: string; limit: number; bucketId?: string }) {
    const bucketIds = opts.bucketId
      ? [(await requireBucketMembership(userId, opts.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);

    const rows = await prisma.conversation.findMany({
      where: { bucketId: { in: bucketIds } },
      orderBy: { importedAt: 'desc' },
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

  async getTranscript(userId: string, conversationId: string, opts: { cursor?: number; limit: number }) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw AppError.notFound('Conversation not found');
    await requireBucketMembership(userId, conversation.bucketId, 'viewer');

    const messages = await prisma.message.findMany({
      where: { conversationId, position: { gte: opts.cursor ?? 0 } },
      orderBy: { position: 'asc' },
      take: opts.limit,
      select: { id: true, role: true, content: true, position: true, createdAt: true },
    });

    const nextCursor =
      messages.length === opts.limit && messages[messages.length - 1].position + 1 < conversation.messageCount
        ? messages[messages.length - 1].position + 1
        : null;

    return { conversation: toPublic(conversation), messages, nextCursor };
  },

  /**
   * Phase 15 (US-INT-06, MemoryPlugin_Clone_Spec.md §6 `DELETE /api/chat-history/chats`):
   * irreversible — no soft-delete, no placeholder. That's the deliberate difference from the
   * still-unbuilt Exclude operation (Phase 21/22), which keeps a placeholder specifically so a
   * future sync never re-adds it; Delete here is the "just get rid of it, a resync can bring it
   * back" half of that pair, matching what the spec's own data model documents for Conversation.
   * Message/MessageChunk cascade off Conversation at the schema level, so removing the
   * Conversation row is the whole operation.
   *
   * Per-ID, not all-or-nothing (contrast `memory.service.ts`'s bulkMove) — one inaccessible ID in
   * a batch of otherwise-owned conversations shouldn't block deleting the rest.
   */
  async deleteMany(userId: string, ids: string[]): Promise<{ deleted: number; failed: string[] }> {
    const failed: string[] = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        const conversation = await prisma.conversation.findUnique({ where: { id } });
        if (!conversation) throw AppError.notFound('Conversation not found');
        await requireBucketMembership(userId, conversation.bucketId, 'editor');
        await prisma.conversation.delete({ where: { id } });
        deleted++;
      } catch {
        failed.push(id);
      }
    }
    return { deleted, failed };
  },
};
