import crypto from 'crypto';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { requireBucketMembership } from '../../shared/bucketAccess';
import { getConversationImportProvider, type ParsedConversation, type ParsedMessage } from '../../shared/providers/chat-import.provider';
import { tokenCount } from '../../shared/tokenizer';
import { historyLimitService } from './history-limit.service';
import { syncService } from './sync.service';

// MemoryPlugin_Clone_Spec.md §6: `/api/chat-history/ingest/custom-online` caps a single
// conversation at 100,000 tokens — the payload-size cap (50MB) is enforced separately, at the
// body-parser level (see app.ts), since that's a transport concern, not a domain one.
const MAX_INGEST_TOKENS = 100_000;

function contentHash(platform: string, parsed: ParsedConversation): string {
  // Fallback idempotency key when the export has no platform id (Phase5_Implementation_Plan.md
  // §4): keyed on the conversation's shape, not its full transcript, so an edit to a later
  // message during a resync updates the existing row instead of spawning a duplicate.
  const first = parsed.messages[0];
  const basis = `${platform}|${first.createdAt.toISOString()}|${parsed.messages.length}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

/**
 * Phase 21 (ADR-adjacent to Exclude, MemoryPlugin_Clone_Spec.md §3.3 "never re-imported"): an
 * excluded conversation's placeholder row is matched by the same key as any other conversation,
 * but content is never written back onto it — returning `skipped: true` here is what makes both
 * callers below refuse to re-queue `syncService.processConversation` for it, so Exclude actually
 * holds across a later sync/import instead of being silently undone by the next one.
 */
async function upsertConversation(
  userId: string,
  bucketId: string,
  platform: string,
  parsed: ParsedConversation,
): Promise<{ conversation: { id: string }; skipped: boolean }> {
  const hash = contentHash(platform, parsed);

  const existing = await prisma.conversation.findFirst({
    where: {
      bucketId,
      platform,
      OR: [...(parsed.externalId ? [{ externalId: parsed.externalId }] : []), { contentHash: hash }],
    },
  });

  if (existing?.excludedAt) {
    return { conversation: existing, skipped: true };
  }

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

  return { conversation, skipped: false };
}

export const importService = {
  async importFile(
    userId: string,
    bucketId: string,
    platform: string,
    buffer: Buffer,
  ): Promise<{ conversationsQueued: number }> {
    await requireBucketMembership(userId, bucketId, 'editor');
    await historyLimitService.assertWithinLimit(userId, platform);

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
      const { conversation, skipped } = await upsertConversation(userId, bucketId, platform, parsed);
      if (!skipped) conversationIds.push(conversation.id);
    }

    // Fire-and-forget, same shape as embedding.service.ts's process() — the HTTP response
    // returns before chunking/embedding runs.
    for (const id of conversationIds) {
      void syncService.processConversation(id);
    }

    return { conversationsQueued: conversationIds.length };
  },

  /**
   * Phase 15 (US-INT-06): programmatic JSON ingest — the direct-API path any external tool can
   * push a conversation through, distinct from the file-upload path above but sharing its exact
   * upsert-by-`externalId` dedup key (`upsertConversation`), so the same conversation pushed twice
   * — whether by file or by this endpoint — never duplicates (MemoryPlugin_Clone_Spec.md §5.4's
   * "duplicate-safe" requirement applies identically to both ingestion paths, not just file import).
   */
  async ingestCustomOnline(
    userId: string,
    bucketId: string,
    platform: string,
    conversation: { externalId: string; title: string; messages: ParsedMessage[] },
  ): Promise<{ status: 'queued' | 'skipped' }> {
    await requireBucketMembership(userId, bucketId, 'editor');
    await historyLimitService.assertWithinLimit(userId, platform);

    const totalTokens = conversation.messages.reduce((sum, m) => sum + tokenCount(m.content), 0);
    if (totalTokens > MAX_INGEST_TOKENS) {
      throw AppError.badRequest(
        `This conversation is ${totalTokens} tokens, over the ${MAX_INGEST_TOKENS}-token ingest limit.`,
        'INGEST_TOO_LARGE',
      );
    }

    const { conversation: saved, skipped } = await upsertConversation(userId, bucketId, platform, {
      externalId: conversation.externalId,
      title: conversation.title,
      messages: conversation.messages,
    });
    // Phase 21: an excluded conversation's placeholder is matched but never re-populated —
    // 'skipped' tells the caller nothing was queued, distinct from a genuine 'queued' ingest.
    if (skipped) return { status: 'skipped' };

    // Same fire-and-forget shape as importFile() above — the caller gets `{status: 'queued'}`
    // immediately, chunking/embedding happens after the response.
    void syncService.processConversation(saved.id);
    return { status: 'queued' };
  },
};
