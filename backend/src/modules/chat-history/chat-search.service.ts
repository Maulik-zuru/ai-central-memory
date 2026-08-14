import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { toVectorLiteral } from '../../shared/vector';
import { getCacheProvider } from '../../shared/providers/cache.provider';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';
import { hasPlan } from '../../shared/requirePlan';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { recall, recallAndSummarize, type RecallSummary } from './recall.service';

const CACHE_TTL_MS = 60_000;
const CANDIDATE_LIMIT = 20;

// Retrofit (docs/Phase10_Implementation_Plan.md §3): precise (rerank) search is a Pro feature;
// Core gets a capped number of uses as a preview, per the PRD's own "preview may be available on
// Core" tier note — not an outright block. Counted via AuditLog (the existing action-count
// mechanism), not a new counter table, since this is the only place that needs the count.
const CORE_PRECISE_SEARCH_PREVIEW_LIMIT = 5;
const PRECISE_SEARCH_ACTION = 'chat_search.precise';

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

    // Phase 17 (US-ARC-07): the "matched chunks and scores, no synthesis" endpoint the OpenAPI
    // doc already describes this as — powered by hybrid search + RRF now, not raw cosine alone.
    // Rerank (Stage 3) is the existing semantic/precise split's own knob; per-chunk relevance
    // assessment (Stage 4) and query expansion (Stage 1) stay reserved for the AI-synthesized
    // `/inject` path and the MCP tool — this raw endpoint is deliberately the fast/cheap tier the
    // spec frames Stage 4 latency against, not where that cost is meant to be spent.
    const expanded = await recall(bucketIds, params.query, { rerank: params.mode === 'precise' });

    // Collapses back to one row per conversation (its single best-ranked hit) to keep this
    // endpoint's existing, documented response shape — a conversation with several matching
    // chunks still surfaces once, same as the pre-Phase-17 `DISTINCT ON` behavior, just powered
    // by the new pipeline's ranking underneath.
    const seenConversations = new Set<string>();
    const collapsed = expanded.filter((row) => {
      if (seenConversations.has(row.conversationId)) return false;
      seenConversations.add(row.conversationId);
      return true;
    });

    const results: ChatSearchResult[] = collapsed.slice(0, CANDIDATE_LIMIT).map((row, i, arr) => ({
      conversationId: row.conversationId,
      title: row.title,
      platform: row.platform,
      preview: row.content.slice(0, 240),
      // Rank-derived, not a raw cosine distance anymore — hybrid+rerank order has no single
      // underlying distance to invert. Still a monotonically decreasing "how good was this
      // match" figure in [0,1], which is all any caller has ever actually relied on.
      score: arr.length > 1 ? 1 - i / arr.length : 1,
    }));

    cache.set(key, results, CACHE_TTL_MS);
    if (params.mode === 'precise' && !(await hasPlan(userId, 'pro'))) {
      await auditService.record(userId, PRECISE_SEARCH_ACTION);
    }
    return results;
  },

  /**
   * `POST /api/chat-history/inject` (MemoryPlugin_Clone_Spec.md §6): the full six-stage pipeline,
   * every stage on — the recall_chat_history MCP tool (Phase 16) calls the exact same
   * recallAndSummarize() this does, "one pipeline, multiple callers" per the plan.
   */
  async inject(userId: string, params: { query: string; bucketId?: string; maxTokens: number }): Promise<RecallSummary> {
    const bucketIds = params.bucketId
      ? [(await requireBucketMembership(userId, params.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);
    if (bucketIds.length === 0) return { summary: '', citations: [] };

    return recallAndSummarize(bucketIds, params.query, {
      expandQuery: true,
      rerank: true,
      assessRelevance: true,
      tokenBudget: params.maxTokens,
    });
  },
};
