import crypto from 'crypto';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { requireBucketMembership } from '../../shared/bucketAccess';
import { getConversationImportProvider, type ParsedConversation } from '../../shared/providers/chat-import.provider';
import { historyLimitService } from './history-limit.service';
import { syncService } from './sync.service';

function contentHash(platform: string, parsed: ParsedConversation): string {
  // Fallback idempotency key when the export has no platform id (Phase5_Implementation_Plan.md
  // §4): keyed on the conversation's shape, not its full transcript, so an edit to a later
  // message during a resync updates the existing row instead of spawning a duplicate.
  const first = parsed.messages[0];
  const basis = `${platform}|${first.createdAt.toISOString()}|${parsed.messages.length}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

async function upsertConversation(userId: string, bucketId: string, platform: string, parsed: ParsedConversation) {
  const hash = contentHash(platform, parsed);

  const existing = await prisma.conversation.findFirst({
    where: {
      bucketId,
      platform,
      OR: [...(parsed.externalId ? [{ externalId: parsed.externalId }] : []), { contentHash: hash }],
    },
  });

  const conversation = existing
    ? await prisma.conversation.update({
        where: { id: existing.id },
        data: { title: parsed.title, messageCount: parsed.messages.length, status: 'importing' },
      })
    : await prisma.conversation.create({
        data: {
          bucketId,
          userId,
          platform,
          externalId: parsed.externalId,
          contentHash: hash,
          title: parsed.title,
          messageCount: parsed.messages.length,
          status: 'importing',
        },
      });

  // Idempotent message upsert: re-importing the same export is a no-op per message (unique on
  // conversationId+position); a resync that appends new messages only inserts the new positions
  // — this is what makes US-ARC-02's "run it twice, zero duplicates" hold at the message level
  // too, not just the conversation level.
  for (const [position, message] of parsed.messages.entries()) {
    await prisma.message.upsert({
      where: { conversationId_position: { conversationId: conversation.id, position } },
      update: { content: message.content, role: message.role, createdAt: message.createdAt },
      create: {
        conversationId: conversation.id,
        position,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      },
    });
  }

  return conversation;
}

export const importService = {
  async importFile(
    userId: string,
    bucketId: string,
    platform: string,
    buffer: Buffer,
  ): Promise<{ conversationsQueued: number }> {
    await requireBucketMembership(userId, bucketId, 'editor');
    await historyLimitService.assertWithinLimit(userId);

    const provider = getConversationImportProvider(platform);
    if (!provider) {
      throw AppError.badRequest(`"${platform}" isn't a supported import source yet.`, 'UNSUPPORTED_PLATFORM');
    }

    let parsedConversations: ParsedConversation[];
    try {
      parsedConversations = provider.parse(buffer);
    } catch (err) {
      throw AppError.badRequest(
        `Couldn't read this file as a ${platform} export: ${err instanceof Error ? err.message : 'invalid format'}`,
        'IMPORT_PARSE_FAILED',
      );
    }

    const conversationIds: string[] = [];
    for (const parsed of parsedConversations) {
      const conversation = await upsertConversation(userId, bucketId, platform, parsed);
      conversationIds.push(conversation.id);
    }

    // Fire-and-forget, same shape as embedding.service.ts's process() — the HTTP response
    // returns before chunking/embedding runs.
    for (const id of conversationIds) {
      void syncService.processConversation(id);
    }

    return { conversationsQueued: conversationIds.length };
  },
};
