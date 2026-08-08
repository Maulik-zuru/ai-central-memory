import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { getCacheProvider } from '../../shared/providers/cache.provider';
import { toVectorLiteral } from '../../shared/vector';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';
import { hasPlan } from '../../shared/requirePlan';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';

const CACHE_TTL_MS = 60_000;
const CANDIDATE_LIMIT = 20;

// Retrofit (docs/Phase10_Implementation_Plan.md §3): precise (rerank) search is a Pro feature;
// Core gets a capped number of uses as a preview, per the PRD's own "preview may be available on
// Core" tier note — not an outright block. Counted via AuditLog (the existing action-count
// mechanism), not a new counter table, since this is the only place that needs the count.
const CORE_PRECISE_SEARCH_PREVIEW_LIMIT = 5;
const PRECISE_SEARCH_ACTION = 'chat_search.precise';

interface CandidateRow {
  conversationId: string;
  title: string;
  platform: string;
  bestChunk: string;
  distance: number;
}

// Full-content candidate row for Ask's fan-out (Phase7_Implementation_Plan.md §4) — the same
// best-chunk-per-conversation query `search()` already runs, exported separately so Ask gets
// untruncated content and message position (for citation deep-linking) instead of the
// already-truncated-to-preview shape search() returns over HTTP.
export interface TopCandidate {
  chunkId: string;
  conversationId: string;
  title: string;
  content: string;
  position: number;
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
  async topCandidates(bucketIds: string[], embedding: number[], limit = CANDIDATE_LIMIT): Promise<TopCandidate[]> {
    if (bucketIds.length === 0) return [];
    const vectorLiteral = toVectorLiteral(embedding);

    const rows = await prisma.$queryRaw<
      { chunkId: string; conversationId: string; title: string; content: string; position: number; distance: number }[]
    >`
      SELECT DISTINCT ON (c.id) mc.id AS "chunkId", c.id AS "conversationId", c.title,
        mc.content, m.position,
        (mc.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "MessageChunk" mc
      JOIN "Message" m ON m.id = mc."messageId"
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE c."bucketId" IN (${Prisma.join(bucketIds)})
        AND mc.embedding IS NOT NULL
      ORDER BY c.id, distance ASC
    `;

    return rows.sort((a, b) => a.distance - b.distance).slice(0, limit);
  },

  async search(
    userId: string,
    params: { query: string; bucketId?: string; mode: 'semantic' | 'precise' },
  ): Promise<ChatSearchResult[]> {
    if (params.mode === 'precise' && !(await hasPlan(userId, 'pro'))) {
      const previousUses = await prisma.auditLog.count({ where: { userId, action: PRECISE_SEARCH_ACTION } });
      if (previousUses >= CORE_PRECISE_SEARCH_PREVIEW_LIMIT) {
        throw AppError.forbidden(
          `You've used your ${CORE_PRECISE_SEARCH_PREVIEW_LIMIT} free precise searches. Upgrade to Pro for unlimited precise search.`,
          'PRO_FEATURE',
        );
      }
    }

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
    if (params.mode === 'precise' && !(await hasPlan(userId, 'pro'))) {
      await auditService.record(userId, PRECISE_SEARCH_ACTION);
    }
    return results;
  },
};
