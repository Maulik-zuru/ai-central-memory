import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';
import { summaryService } from './summary.service';
import { analyticsService } from '../intelligence/analytics.service';

const MAX_CHUNK_CHARS = 1000;

// A message rarely needs splitting, but a very long one (a pasted document, a long code block)
// should still cite/embed in bounded pieces rather than one giant vector diluting similarity —
// same reasoning as Phase 6's page-aware chunker, just without the page dimension.
function chunkContent(content: string): string[] {
  if (content.length <= MAX_CHUNK_CHARS) return [content];
  const chunks: string[] = [];
  let rest = content;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, MAX_CHUNK_CHARS));
    rest = rest.slice(MAX_CHUNK_CHARS);
  }
  return chunks;
}

// The resumable step (US-ARC-02's cancel/retry ACs): processes messages starting at
// Conversation.syncCursor, advancing the cursor after each message's chunks commit — not after
// the whole conversation — so a crash or cancellation mid-conversation resumes from the last
// committed message, never from position 0.
export const syncService = {
  async processConversation(conversationId: string): Promise<void> {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return;

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { position: 'asc' },
      skip: conversation.syncCursor,
    });

    const provider = getLlmProvider();

    try {
      for (const message of messages) {
        const pieces = chunkContent(message.content);
        for (const piece of pieces) {
          const embedding = await provider.embed(piece);
          const chunk = await prisma.messageChunk.create({
            data: { messageId: message.id, content: piece },
          });
          await prisma.$executeRaw`
            UPDATE "MessageChunk" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${chunk.id}
          `;
        }
        // updateMany rather than update: the conversation (and its cascade-deleted messages) may
        // have been removed by the caller while this fire-and-forget step was still running — 0
        // rows affected is a no-op then, not a thrown "record not found" that update() would
        // raise for a row that's supposed to still exist.
        const stillExists = await prisma.conversation.updateMany({
          where: { id: conversationId },
          data: { syncCursor: message.position + 1 },
        });
        if (stillExists.count === 0) return;
      }

      await prisma.conversation.updateMany({
        where: { id: conversationId },
        data: { status: 'ready', errorReason: null, lastSyncedAt: new Date() },
      });
      analyticsService.record(conversation.userId, 'sync_completed');

      await summaryService.summarize(conversationId).catch((err) => {
        logger.error({ err, conversationId }, 'Post-sync summarization failed (non-fatal)');
      });
    } catch (err) {
      logger.error({ err, conversationId }, 'Conversation sync failed');
      await prisma.conversation
        .updateMany({
          where: { id: conversationId },
          data: { status: 'error', errorReason: err instanceof Error ? err.message : 'Unknown error' },
        })
        .catch(() => {
          // The conversation is gone entirely (e.g. its bucket was deleted mid-sync) — nothing
          // left to mark as errored.
        });
    }
  },
};
