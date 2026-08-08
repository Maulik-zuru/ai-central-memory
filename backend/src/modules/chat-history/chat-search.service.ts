import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { getCacheProvider } from '../../shared/providers/cache.provider';
import { toVectorLiteral } from '../../shared/vector';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';

const CACHE_TTL_MS = 60_000;
const CANDIDATE_LIMIT = 20;

interface CandidateRow {
  conversationId: string;
  title: string;
  platform: string;
  bestChunk: string;
  distance: number;
}

export interface ChatSearchResult {
  conversationId: string;
  title: string;
  platform: string;
  preview: string;
  score: number;
}

function cacheKey(userId: string, bucketId: string | undefined, mode: string, query: string): string {
  const hash = crypto.createHash('sha1').update(query).digest('hex');
  return `chat-search:${userId}:${bucketId ?? 'all'}:${mode}:${hash}`;
}

export const chatSearchService = {
  async search(
    userId: string,
    params: { query: string; bucketId?: string; mode: 'semantic' | 'precise' },
  ): Promise<ChatSearchResult[]> {
    const bucketIds = params.bucketId
      ? [(await requireBucketMembership(userId, params.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);
    if (bucketIds.length === 0) return [];

    const key = cacheKey(userId, params.bucketId, params.mode, params.query);
    const cache = getCacheProvider();
    const cached = cache.get<ChatSearchResult[]>(key);
    if (cached) return cached;

    const provider = getLlmProvider();
    const queryEmbedding = await provider.embed(params.query);
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    // Best-matching chunk per conversation, scoped to accessible buckets — DISTINCT ON picks the
    // lowest-distance row per conversationId, so a conversation with many matching chunks still
    // surfaces once, ranked by its single best match.
    const rows = await prisma.$queryRaw<CandidateRow[]>`
      SELECT DISTINCT ON (c.id) c.id AS "conversationId", c.title, c.platform,
        mc.content AS "bestChunk",
        (mc.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "MessageChunk" mc
      JOIN "Message" m ON m.id = mc."messageId"
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c."bucketId" IN (${Prisma.join(bucketIds)})
        AND mc.embedding IS NOT NULL
      ORDER BY c.id, distance ASC
    `;

    let ranked = rows.sort((a, b) => a.distance - b.distance).slice(0, CANDIDATE_LIMIT);

    if (params.mode === 'precise' && ranked.length > 1) {
      const order = await provider.rerank(
        params.query,
        ranked.map((r) => ({ id: r.conversationId, content: r.bestChunk })),
      );
      const byId = new Map(ranked.map((r) => [r.conversationId, r]));
      ranked = order.map((id) => byId.get(id)).filter((r): r is CandidateRow => Boolean(r));
    }

    const results: ChatSearchResult[] = ranked.map((r) => ({
      conversationId: r.conversationId,
      title: r.title,
      platform: r.platform,
      preview: r.bestChunk.slice(0, 240),
      score: 1 - r.distance,
    }));

    cache.set(key, results, CACHE_TTL_MS);
    return results;
  },
};
