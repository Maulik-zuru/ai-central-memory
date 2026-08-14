import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { getLlmProvider, callProvider } from '../../shared/providers/llm.provider';
import { getCacheProvider } from '../../shared/providers/cache.provider';
import { toVectorLiteral } from '../../shared/vector';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';

const CACHE_TTL_MS = 60_000;

interface CandidateRow {
  fileId: string;
  filename: string;
  page: number;
  bestChunk: string;
  distance: number;
}

export interface FileSearchResult {
  fileId: string;
  filename: string;
  page: number;
  preview: string;
  score: number;
}

// Full-content candidate row for Ask's fan-out (Phase7_Implementation_Plan.md §4) — same
// best-chunk-per-file query `search()` runs, exported separately so Ask gets untruncated content
// instead of the preview-truncated shape `search()` returns over HTTP.
export interface TopCandidate {
  chunkId: string;
  fileId: string;
  filename: string;
  content: string;
  page: number;
  distance: number;
}

function cacheKey(userId: string, bucketId: string | undefined, query: string): string {
  const hash = crypto.createHash('sha1').update(query).digest('hex');
  return `file-search:${userId}:${bucketId ?? 'all'}:${hash}`;
}

// US-FIL-04: matches on extracted content, not filename alone — the query is embedded and
// compared against FileChunk content, the same way chat-search.service.ts ranks conversations.
const CANDIDATE_LIMIT = 20;

export const fileSearchService = {
  async topCandidates(bucketIds: string[], embedding: number[], limit = CANDIDATE_LIMIT): Promise<TopCandidate[]> {
    if (bucketIds.length === 0) return [];
    const vectorLiteral = toVectorLiteral(embedding);

    const rows = await prisma.$queryRaw<
      { chunkId: string; fileId: string; filename: string; content: string; page: number; distance: number }[]
    >`
      SELECT DISTINCT ON (f.id) fc.id AS "chunkId", f.id AS "fileId", f.filename,
        fc.content, fc.page,
        (fc.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "FileChunk" fc
      JOIN "File" f ON f.id = fc."fileId"
      WHERE f."bucketId" IN (${Prisma.join(bucketIds)})
        AND fc.embedding IS NOT NULL
        AND f.status = 'ready'
      ORDER BY f.id, distance ASC
    `;

    return rows.sort((a, b) => a.distance - b.distance).slice(0, limit);
  },

  async search(userId: string, params: { query: string; bucketId?: string }): Promise<FileSearchResult[]> {
    const bucketIds = params.bucketId
      ? [(await requireBucketMembership(userId, params.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);
    if (bucketIds.length === 0) return [];

    const key = cacheKey(userId, params.bucketId, params.query);
    const cache = getCacheProvider();
    const cached = cache.get<FileSearchResult[]>(key);
    if (cached) return cached;

    const queryEmbedding = await callProvider(
      () => getLlmProvider().embed(params.query),
      'Could not search your files right now — the AI provider is temporarily unavailable.',
    );
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    const rows = await prisma.$queryRaw<CandidateRow[]>`
      SELECT DISTINCT ON (f.id) f.id AS "fileId", f.filename, fc.page,
        fc.content AS "bestChunk",
        (fc.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "FileChunk" fc
      JOIN "File" f ON f.id = fc."fileId"
      WHERE f."bucketId" IN (${Prisma.join(bucketIds)})
        AND fc.embedding IS NOT NULL
        AND f.status = 'ready'
      ORDER BY f.id, distance ASC
    `;

    const results: FileSearchResult[] = rows
      .sort((a, b) => a.distance - b.distance)
      .map((r) => ({
        fileId: r.fileId,
        filename: r.filename,
        page: r.page,
        preview: r.bestChunk.slice(0, 240),
        score: 1 - r.distance,
      }));

    cache.set(key, results, CACHE_TTL_MS);
    return results;
  },
};
