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

// Phase 20 (Smart Memory two-tier rebuild): how close a snippet's embedding must land to a
// category's centroid to expand that category's full memory list. Looser than the batch job's own
// CATEGORY_DISTANCE_THRESHOLD (0.35, categorization-batch.service.ts) — clustering decides "does
// this memory belong in this group," a stricter question than "is this group worth opening,"
// deliberately calibrated separately (same first-guess status as every other constant here).
const CATEGORY_EXPANSION_DISTANCE_THRESHOLD = 0.7;
const MAX_EXPANDED_CATEGORIES = TOP_CATEGORY_MATCHES;

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
  /**
   * Phase 20: present only when a single, already-categorized bucket is in scope (`bucketId` given
   * and its batch categorization job has run at least once) — every one of that bucket's
   * categories, each flagged `expanded` if its memories contributed to `memories` this call. Absent
   * for the flat scorer paths (no `bucketId`, Smart Mode off, or a bucket not yet categorized).
   */
  categories?: CategoryTier[];
}

export interface CategoryTier {
  id: string;
  label: string;
  summary: string;
  additionalContext: string;
  memoryCount: number;
  expanded: boolean;
}

/**
 * Phase 18 (§7.4 "lost in the middle"): a strength-descending list gets its strongest item
 * anchored at the front and its second-strongest anchored at the very end — the two positions an
 * LLM attends to most reliably — rather than left in monotonic descending order, which buries the
 * strongest items in the middle of a long injected block right along with the weakest ones. This
 * reorders which *position* each already-selected item lands in; it never changes which items get
 * selected in the first place, that still happens under the token budget in score order first.
 */
export function placeStrongestAtEdges<T>(rankedDescending: T[]): T[] {
  if (rankedDescending.length === 0) return [];
  const [strongest, ...rest] = rankedDescending;
  return [strongest, ...rest.reverse()];
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

  /**
   * Phase 20 (MemoryPlugin_Clone_Spec.md §5.1): category summaries load first (cheap — this method
   * doesn't even touch memory content until it decides which categories to expand), then only the
   * categories whose centroid is close enough to the live snippet get their full memory list
   * expanded and scored, budgeted the same way the flat scorer always was. Deliberately scoped to
   * one already-categorized bucket at a time — see `buildContext`'s own comment for why a
   * multi-bucket or not-yet-categorized scope still falls back to the flat scorer.
   */
  async buildTwoTierContext(
    bucketId: string,
    categories: { id: string; label: string; summary: string; additionalContext: string; memoryCount: number }[],
    snippetEmbedding: number[],
    tokenBudget: number,
  ): Promise<ContextResult> {
    const vectorLiteral = toVectorLiteral(snippetEmbedding);
    const categoryIds = categories.map((c) => c.id);
    const distanceRows = await prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (centroid <=> ${vectorLiteral}::vector) AS distance
      FROM "Category"
      WHERE id IN (${Prisma.join(categoryIds)}) AND centroid IS NOT NULL
    `;
    const distanceById = new Map(distanceRows.map((d) => [d.id, d.distance]));

    const expandedIds = new Set(
      categories
        .filter((c) => (distanceById.get(c.id) ?? Infinity) <= CATEGORY_EXPANSION_DISTANCE_THRESHOLD)
        .sort((a, b) => distanceById.get(a.id)! - distanceById.get(b.id)!)
        .slice(0, MAX_EXPANDED_CATEGORIES)
        .map((c) => c.id),
    );

    const categorized = await prisma.$queryRaw<CandidateRow[]>`
      SELECT id, content, "createdAt", "categoryId",
        (embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "Memory"
      WHERE "categoryId" IN (${Prisma.join(categoryIds)}) AND status = 'active' AND embedding IS NOT NULL
    `;
    const everythingTokens = categorized.reduce((sum, c) => sum + tokenCount(c.content), 0);

    const now = Date.now();
    const scored = categorized
      .filter((c) => c.categoryId && expandedIds.has(c.categoryId))
      .map((c) => {
        const similarity = 1 - c.distance;
        const ageInDays = (now - c.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const recencyDecay = Math.exp(-ageInDays / RECENCY_HALF_LIFE_DAYS);
        return { c, score: SIMILARITY_WEIGHT * similarity + RECENCY_WEIGHT * recencyDecay };
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

    return {
      smartModeEnabled: true,
      memories: placeStrongestAtEdges(selected),
      actualTokens,
      everythingTokens,
      tokenBudget,
      // No per-memory category bonus here — which categories matter was already decided at the
      // tier-1 expansion step above, not re-scored per memory the way the flat path's
      // CATEGORY_WEIGHT term does.
      weights: { similarity: SIMILARITY_WEIGHT, recency: RECENCY_WEIGHT, category: 0, recencyHalfLifeDays: RECENCY_HALF_LIFE_DAYS },
      categories: categories.map((c) => ({
        id: c.id,
        label: c.label,
        summary: c.summary,
        additionalContext: c.additionalContext,
        memoryCount: c.memoryCount,
        expanded: expandedIds.has(c.id),
      })),
    };
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

    // Phase 20: two-tier retrieval only applies to a single, already-categorized bucket — spanning
    // every accessible bucket (no bucketId) has no single category set to be "two-tier" about, and
    // a bucket that has never been through the batch job has no summaries to load first either.
    // Both cases fall through to the flat scorer below, unchanged from before this phase.
    if (params.bucketId && smartModeEnabled) {
      const categories = await prisma.category.findMany({ where: { bucketId: params.bucketId } });
      if (categories.length > 0) {
        const result = await this.buildTwoTierContext(params.bucketId, categories, snippetEmbedding, tokenBudget);
        cache.set(key, result, CACHE_TTL_MS);
        analyticsService.record(userId, 'context_preview', { tokensSaved: result.everythingTokens - result.actualTokens });
        return result;
      }
    }

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
        memories: placeStrongestAtEdges(selected),
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
