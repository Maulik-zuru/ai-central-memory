import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { prisma } from '../../shared/prisma';
import { getLlmProvider, callProvider } from '../../shared/providers/llm.provider';
import { getCacheProvider } from '../../shared/providers/cache.provider';
import { toVectorLiteral } from '../../shared/vector';
import { tokenCount } from '../../shared/tokenizer';
import { accessibleBucketIds } from '../../shared/bucketAccess';
import { analyticsService } from '../intelligence/analytics.service';

export const DEFAULT_TOKEN_BUDGET = 2000;
const CACHE_TTL_MS = 60_000;

// A first calibrated guess, not a settled constant — Phase4_Implementation_Plan.md §5.2 flags
// these weights and the 30-day half-life for Phase 12's load testing to re-tune.
const SIMILARITY_WEIGHT = 0.6;
const RECENCY_WEIGHT = 0.25;
const CATEGORY_WEIGHT = 0.15;
const RECENCY_HALF_LIFE_DAYS = 30;
const TOP_CATEGORY_MATCHES = 3;

interface CandidateRow {
  id: string;
  content: string;
  createdAt: Date;
  categoryId: string | null;
  distance: number;
}

export interface RetrievedMemory {
  id: string;
  content: string;
  categoryId: string | null;
  score: number;
  createdAt: Date;
}

export interface ContextResult {
  smartModeEnabled: boolean;
  memories: RetrievedMemory[];
  actualTokens: number;
  everythingTokens: number;
  tokenBudget: number;
  weights: { similarity: number; recency: number; category: number; recencyHalfLifeDays: number };
}

function cacheKey(userId: string, bucketId: string | undefined, snippet: string, smartModeEnabled: boolean): string {
  const hash = crypto.createHash('sha1').update(snippet).digest('hex');
  // Smart Mode is part of the cache identity, not just the scope/snippet — otherwise flipping
  // the toggle and immediately re-running the same snippet would serve the pre-toggle result
  // straight out of cache for up to CACHE_TTL_MS, silently contradicting the flip that just
  // happened (US-ADV-01's "the user can see why" only holds if the preview actually changes).
  return `context:${userId}:${bucketId ?? 'all'}:${smartModeEnabled}:${hash}`;
}

async function resolveScopeBucketIds(userId: string, bucketId?: string): Promise<string[]> {
  if (bucketId) return [bucketId];
  return accessibleBucketIds(userId);
}

export const retrievalService = {
  /** Exposed so tests can assert the underlying scoring query ran exactly once per cache miss. */
  async scoreCandidates(bucketIds: string[], snippetEmbedding: number[]): Promise<CandidateRow[]> {
    if (bucketIds.length === 0) return [];
    const vectorLiteral = toVectorLiteral(snippetEmbedding);
    return prisma.$queryRaw<CandidateRow[]>`
      SELECT id, content, "createdAt", "categoryId",
        (embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "Memory"
      WHERE "bucketId" IN (${Prisma.join(bucketIds)})
        AND status = 'active'
        AND embedding IS NOT NULL
    `;
  },

  async topCategoryIds(categoryIds: string[], snippetEmbedding: number[]): Promise<Set<string>> {
    if (categoryIds.length === 0) return new Set();
    const vectorLiteral = toVectorLiteral(snippetEmbedding);
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Category"
      WHERE id IN (${Prisma.join(categoryIds)}) AND centroid IS NOT NULL
      ORDER BY (centroid <=> ${vectorLiteral}::vector) ASC
      LIMIT ${TOP_CATEGORY_MATCHES}
    `;
    return new Set(rows.map((r) => r.id));
  },

  async buildContext(
    userId: string,
    params: { snippet: string; bucketId?: string; tokenBudget?: number },
  ): Promise<ContextResult> {
    const tokenBudget = params.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const bucketIds = await resolveScopeBucketIds(userId, params.bucketId);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { smartMemoryEnabled: true } });
    const smartModeEnabled = user?.smartMemoryEnabled ?? true;

    const key = cacheKey(userId, params.bucketId, params.snippet, smartModeEnabled);
    const cache = getCacheProvider();
    const cached = cache.get<ContextResult>(key);
    if (cached) return cached;

    const provider = getLlmProvider();
    const snippetEmbedding = await callProvider(
      () => provider.embed(params.snippet),
      'Could not check your memories right now — the AI provider is temporarily unavailable.',
    );
    const candidates = await this.scoreCandidates(bucketIds, snippetEmbedding);

    const everythingTokens = candidates.reduce((sum, c) => sum + tokenCount(c.content), 0);

    let result: ContextResult;
    if (!smartModeEnabled) {
      result = {
        smartModeEnabled,
        memories: candidates.map((c) => ({
          id: c.id,
          content: c.content,
          categoryId: c.categoryId,
          score: 1,
          createdAt: c.createdAt,
        })),
        actualTokens: everythingTokens,
        everythingTokens,
        tokenBudget,
        weights: {
          similarity: SIMILARITY_WEIGHT,
          recency: RECENCY_WEIGHT,
          category: CATEGORY_WEIGHT,
          recencyHalfLifeDays: RECENCY_HALF_LIFE_DAYS,
        },
      };
    } else {
      const distinctCategoryIds = [...new Set(candidates.map((c) => c.categoryId).filter((id): id is string => Boolean(id)))];
      const topCategories = await this.topCategoryIds(distinctCategoryIds, snippetEmbedding);

      const now = Date.now();
      const scored = candidates
        .map((c) => {
          const similarity = 1 - c.distance;
          const ageInDays = (now - c.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          const recencyDecay = Math.exp(-ageInDays / RECENCY_HALF_LIFE_DAYS);
          const categoryMatchBonus = c.categoryId && topCategories.has(c.categoryId) ? 1 : 0;
          const score = SIMILARITY_WEIGHT * similarity + RECENCY_WEIGHT * recencyDecay + CATEGORY_WEIGHT * categoryMatchBonus;
          return { c, score };
        })
        .sort((a, b) => b.score - a.score);

      const selected: RetrievedMemory[] = [];
      let actualTokens = 0;
      for (const { c, score } of scored) {
        const contentTokens = tokenCount(c.content);
        if (actualTokens + contentTokens > tokenBudget) break;
        actualTokens += contentTokens;
        selected.push({ id: c.id, content: c.content, categoryId: c.categoryId, score, createdAt: c.createdAt });
      }

      result = {
        smartModeEnabled,
        memories: selected,
        actualTokens,
        everythingTokens,
        tokenBudget,
        weights: {
          similarity: SIMILARITY_WEIGHT,
          recency: RECENCY_WEIGHT,
          category: CATEGORY_WEIGHT,
          recencyHalfLifeDays: RECENCY_HALF_LIFE_DAYS,
        },
      };
    }

    cache.set(key, result, CACHE_TTL_MS);
    analyticsService.record(userId, 'context_preview', { tokensSaved: result.everythingTokens - result.actualTokens });
    return result;
  },
};
