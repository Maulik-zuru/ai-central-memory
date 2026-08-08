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
};
