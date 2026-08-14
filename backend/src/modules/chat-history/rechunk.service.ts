import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';
import { chunkContent } from './sync.service';

// One batch per findMany call, looped until nothing is left — bounded memory regardless of how
// large the backlog is, and each message commits independently (see rechunkMessage), so an
// interruption between batches loses no progress.
const BATCH_SIZE = 200;

async function rechunkMessage(message: { id: string; content: string }): Promise<void> {
  const provider = getLlmProvider();
  const pieces = chunkContent(message.content);
  // Embeddings are computed before the transaction starts — an external LLM call has no place
  // running inside a DB transaction's timeout window.
  const embeddings = await Promise.all(pieces.map((piece) => provider.embed(piece)));

  await prisma.$transaction(async (tx) => {
    await tx.messageChunk.deleteMany({ where: { messageId: message.id } });
    for (let i = 0; i < pieces.length; i++) {
      const chunk = await tx.messageChunk.create({ data: { messageId: message.id, content: pieces[i] } });
      await tx.$executeRaw`
        UPDATE "MessageChunk" SET embedding = ${toVectorLiteral(embeddings[i])}::vector WHERE id = ${chunk.id}
      `;
    }
    await tx.message.update({ where: { id: message.id }, data: { rechunkedAt: new Date() } });
  });
}

/**
 * Phase 17 (US-ARC-07): backfills `Message.rechunkedAt` for every message imported before this
 * phase's token-based chunking existed, replacing each one's old character-based
 * `MessageChunk`(s) with the new ~256-token, light-overlap shape — the same shape
 * sync.service.ts's `chunkContent()` gives every message imported since. Resumable and idempotent
 * by construction: it only ever selects `rechunkedAt IS NULL` rows, and each message's delete +
 * recreate + mark-migrated happens in one transaction, so a message is never left half-migrated
 * for a re-run to double-process.
 */
export const rechunkService = {
  /** Reports the backlog without writing anything — "run once, dry-run against a copy first". */
  async dryRun(): Promise<{ messagesRemaining: number }> {
    const messagesRemaining = await prisma.message.count({ where: { rechunkedAt: null } });
    return { messagesRemaining };
  },

  async run(): Promise<{ messagesProcessed: number }> {
    let messagesProcessed = 0;
    for (;;) {
      const batch = await prisma.message.findMany({
        where: { rechunkedAt: null },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, content: true },
      });
      if (batch.length === 0) break;
      for (const message of batch) {
        await rechunkMessage(message);
        messagesProcessed++;
      }
    }
    return { messagesProcessed };
  },
};
