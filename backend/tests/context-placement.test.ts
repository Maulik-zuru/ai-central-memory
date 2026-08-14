import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { toVectorLiteral } from '../src/shared/vector';
import { EMBEDDING_DIMENSIONS, __setLlmProviderForTests, getLlmProvider } from '../src/shared/providers/llm.provider';
import { retrievalService, placeStrongestAtEdges } from '../src/modules/context/retrieval.service';

// Phase 18.5 (§7.4 "lost in the middle"): retrieval.service.ts's final assembly step no longer
// hands back a monotonically score-descending list — the strongest item anchors the front and the
// second-strongest anchors the very end, per the plan's own worked example:
// "[strongest, ..., 3rd-strongest, 2nd-strongest]".

const app = createApp();
afterAll(disconnect);

describe('placeStrongestAtEdges — the pure reordering rule', () => {
  it('leaves an empty or single-item list untouched', () => {
    expect(placeStrongestAtEdges([])).toEqual([]);
    expect(placeStrongestAtEdges(['a'])).toEqual(['a']);
  });

  it('leaves a two-item list untouched — front and back are already the only two ranks', () => {
    expect(placeStrongestAtEdges(['1st', '2nd'])).toEqual(['1st', '2nd']);
  });

  it('matches the plan\'s own worked example exactly: strongest front, 2nd-strongest last, 3rd-strongest second-to-last', () => {
    const ranked = ['1st', '2nd', '3rd', '4th'];
    expect(placeStrongestAtEdges(ranked)).toEqual(['1st', '4th', '3rd', '2nd']);
  });

  it('holds the same shape for a longer list — front=1st, then the rest reversed', () => {
    const ranked = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
    expect(placeStrongestAtEdges(ranked)).toEqual(['1st', '6th', '5th', '4th', '3rd', '2nd']);
    // The two edges anchor the strongest pair; the last position is always 2nd-strongest and the
    // second-to-last is always 3rd-strongest, regardless of how many items are in the middle.
    const result = placeStrongestAtEdges(ranked);
    expect(result[0]).toBe('1st');
    expect(result[result.length - 1]).toBe('2nd');
    expect(result[result.length - 2]).toBe('3rd');
  });
});

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

// A unit vector at a controlled cosine similarity to [1,0,0,...] (the "query" embedding below) —
// pgvector's `<=>` on unit vectors is exactly 1 - cosine_similarity, so this pins each seeded
// memory's similarity score to a precise, predictable value.
function vectorAtSimilarity(similarity: number): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = similarity;
  v[1] = Math.sqrt(Math.max(0, 1 - similarity * similarity));
  return v;
}

const QUERY_EMBEDDING = vectorAtSimilarity(1);

async function seedScoredMemory(userId: string, bucketId: string, label: string, similarity: number, createdAt: Date) {
  const memory = await prisma.memory.create({
    data: { userId, bucketId, type: 'text', content: label, source: 'manual', createdAt },
  });
  await prisma.$executeRaw`
    UPDATE "Memory" SET embedding = ${toVectorLiteral(vectorAtSimilarity(similarity))}::vector WHERE id = ${memory.id}
  `;
  return memory.id;
}

describe('retrievalService.buildContext — edge placement, not just item selection (Phase 18.5)', () => {
  beforeEach(resetDb);
  afterEach(() => __setLlmProviderForTests(null));

  it('places the strongest memory first and the second-strongest last, burying weaker ones in between', async () => {
    const { userId, bucketId } = await seedAccount('placement-a@example.com');
    // Same createdAt for every candidate cancels out the recency term entirely, and none get a
    // category, so similarity alone (which these embeddings pin precisely) drives the ranking —
    // the test's expected order isn't at the mercy of the scoring formula's exact weights.
    const sameInstant = new Date('2026-01-01T00:00:00Z');
    const rank1 = await seedScoredMemory(userId, bucketId, 'rank1 content', 0.95, sameInstant);
    const rank2 = await seedScoredMemory(userId, bucketId, 'rank2 content', 0.85, sameInstant);
    const rank3 = await seedScoredMemory(userId, bucketId, 'rank3 content', 0.75, sameInstant);
    const rank4 = await seedScoredMemory(userId, bucketId, 'rank4 content', 0.65, sameInstant);

    const real = getLlmProvider();
    __setLlmProviderForTests({ ...real, embed: async () => QUERY_EMBEDDING });

    const result = await retrievalService.buildContext(userId, { snippet: 'anything', bucketId, tokenBudget: 2000 });

    expect(result.memories.map((m) => m.id)).toEqual([rank1, rank4, rank3, rank2]);
  });
});
