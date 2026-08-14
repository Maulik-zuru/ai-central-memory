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
  excludedAt: Date | null;
  pinned: boolean;
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
   * irreversible — no soft-delete, no placeholder. That's the deliberate difference from Phase
   * 21's Exclude (below), which keeps a placeholder specifically so a future sync never re-adds
   * it; Delete here is the "just get rid of it, a resync can bring it back" half of that pair,
   * matching what the spec's own data model documents for Conversation. Message/MessageChunk
   * cascade off Conversation at the schema level, so removing the Conversation row is the whole
   * operation.
   *
   * Per-ID, not all-or-nothing (contrast `memory.service.ts`'s bulkMove) — one inaccessible ID in
   * a batch of otherwise-owned conversations shouldn't block deleting the rest.
   *
   * Phase 21: a pinned conversation is rejected with a reason, not silently lumped into `failed`
   * — `failed` stays reserved for "not found or not yours," which is why `rejected` is a separate
   * array rather than an overload of the same field (MemoryPlugin_Clone_Spec.md §3.3: pinning
   * "protects a conversation from any future bulk operation").
   */
  async deleteMany(
    userId: string,
    ids: string[],
  ): Promise<{ deleted: number; failed: string[]; rejected: { id: string; reason: string }[] }> {
    const failed: string[] = [];
    const rejected: { id: string; reason: string }[] = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        const conversation = await prisma.conversation.findUnique({ where: { id } });
        if (!conversation) throw AppError.notFound('Conversation not found');
        await requireBucketMembership(userId, conversation.bucketId, 'editor');
        if (conversation.pinned) {
          rejected.push({ id, reason: 'This conversation is pinned — unpin it before deleting.' });
          continue;
        }
        await prisma.conversation.delete({ where: { id } });
        deleted++;
      } catch {
        failed.push(id);
      }
    }
    return { deleted, failed, rejected };
  },

  /**
   * MemoryPlugin_Clone_Spec.md §3.3's Exclude: hard-deletes every `Message` (cascading to
   * `MessageChunk`, taking the embeddings with it) but keeps the `Conversation` row itself as a
   * placeholder with `excludedAt` set — `importService`'s upsert checks this before ever
   * re-adding content, so a re-sync/re-import of the same source can never resurrect it. Contrast
   * `deleteMany` above, which removes the placeholder too and therefore CAN reappear on a later
   * sync/import. Same per-ID, not-all-or-nothing shape as `deleteMany` and pinning applies here
   * too — excluding is itself a bulk operation the spec's pinning protection covers.
   */
  async excludeMany(
    userId: string,
    ids: string[],
  ): Promise<{ excluded: number; failed: string[]; rejected: { id: string; reason: string }[] }> {
    const failed: string[] = [];
    const rejected: { id: string; reason: string }[] = [];
    let excluded = 0;
    for (const id of ids) {
      try {
        const conversation = await prisma.conversation.findUnique({ where: { id } });
        if (!conversation) throw AppError.notFound('Conversation not found');
        await requireBucketMembership(userId, conversation.bucketId, 'editor');
        if (conversation.pinned) {
          rejected.push({ id, reason: 'This conversation is pinned — unpin it before excluding.' });
          continue;
        }
        if (conversation.excludedAt) {
          excluded++; // Already excluded — idempotent, not an error.
          continue;
        }
        await prisma.$transaction([
          prisma.message.deleteMany({ where: { conversationId: id } }),
          prisma.conversation.update({ where: { id }, data: { excludedAt: new Date(), status: 'excluded' } }),
        ]);
        excluded++;
      } catch {
        failed.push(id);
      }
    }
    return { excluded, failed, rejected };
  },

  /** Phase 21: pin/unpin toggle. Pinning itself has no bucket-role floor beyond editor (same as
   * every other conversation-management action here) — it's the *effect* of being pinned
   * (rejected from bulk delete/exclude) that's the actual protection. */
  async setPinned(userId: string, id: string, pinned: boolean) {
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw AppError.notFound('Conversation not found');
    await requireBucketMembership(userId, conversation.bucketId, 'editor');
    return toPublic(await prisma.conversation.update({ where: { id }, data: { pinned } }));
  },
};
