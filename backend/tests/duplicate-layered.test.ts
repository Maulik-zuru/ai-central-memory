import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { toVectorLiteral } from '../src/shared/vector';
import { EMBEDDING_DIMENSIONS } from '../src/shared/providers/llm.provider';
import { duplicateDetectionService } from '../src/modules/memory/duplicate-detection.service';

// Phase 18.4 (§7.4 "layered duplicate matching"): duplicate-detection.service.ts gains an
// exact-string tier and a pg_trgm fuzzy tier ahead of the existing embedding-threshold check —
// each test here pins the embedding vector directly (bypassing the real embed pipeline) so a
// pair's *textual* similarity and its *semantic* (cosine) similarity can be set independently,
// proving which tier actually caught (or didn't catch) each pair.

const app = createApp();
afterAll(disconnect);

function unitVector(dim: number): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[dim] = 1;
  return v;
}

// Orthogonal unit vectors — cosine distance 1, far above DUPLICATE_DISTANCE_THRESHOLD (0.15) — so
// the embedding tier alone would never flag a pair seeded with two different dims as similar.
const ORTHOGONAL_A = unitVector(0);
const ORTHOGONAL_B = unitVector(1);
// Identical vectors — cosine distance 0 — so the embedding tier alone would always flag a pair
// seeded with the same vector as similar, regardless of how dissimilar their text is.
const IDENTICAL_A = unitVector(2);

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

async function seedMemory(userId: string, bucketId: string, content: string, embedding: number[]) {
  const memory = await prisma.memory.create({ data: { userId, bucketId, type: 'text', content, source: 'manual' } });
  await prisma.$executeRaw`UPDATE "Memory" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${memory.id}`;
  return memory.id;
}

async function pendingDuplicatePairs(userId: string) {
  return prisma.memorySuggestion.findMany({ where: { userId, type: 'duplicate', status: 'pending' } });
}

describe('duplicate-detection.service — layered matching (Phase 18.4)', () => {
  beforeEach(resetDb);

  it('flags an exact case-insensitive content match without ever running the embedding-distance query', async () => {
    const { userId, bucketId } = await seedAccount('layered-exact@example.com');
    // Deliberately orthogonal embeddings: if the exact tier didn't short-circuit, the embedding
    // tier alone would conclude these two are completely unrelated.
    const idA = await seedMemory(userId, bucketId, 'I deploy to Railway now', ORTHOGONAL_A);
    const idB = await seedMemory(userId, bucketId, 'i deploy to railway now', ORTHOGONAL_B);

    const querySpy = jest.spyOn(prisma, '$queryRaw');
    await duplicateDetectionService.run(userId, idA);

    const ranEmbeddingDistanceQuery = querySpy.mock.calls.some((call) => {
      const strings = call[0] as unknown as TemplateStringsArray;
      return Array.from(strings).join('').includes('<=>');
    });
    querySpy.mockRestore();
    expect(ranEmbeddingDistanceQuery).toBe(false);

    const pairs = await pendingDuplicatePairs(userId);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].memoryIdA, pairs[0].memoryIdB].sort()).toEqual([idA, idB].sort());
  });

  it('flags a near-identical (punctuation-only difference) pair via the fuzzy tier even when the embedding tier alone would say they are unrelated', async () => {
    const { userId, bucketId } = await seedAccount('layered-fuzzy@example.com');
    const idA = await seedMemory(userId, bucketId, 'The quick brown fox jumps over the lazy dog', ORTHOGONAL_A);
    // Not an exact match (trailing "!") but very high trigram similarity to idA's content.
    const idB = await seedMemory(userId, bucketId, 'The quick brown fox jumps over the lazy dog!', ORTHOGONAL_B);

    await duplicateDetectionService.run(userId, idA);

    const pairs = await pendingDuplicatePairs(userId);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].memoryIdA, pairs[0].memoryIdB].sort()).toEqual([idA, idB].sort());
  });

  it('still falls back to the embedding tier for a genuinely ambiguous pair — different wording, no textual overlap, but semantically close embeddings', async () => {
    const { userId, bucketId } = await seedAccount('layered-embedding@example.com');
    const idA = await seedMemory(userId, bucketId, 'I prefer working from the office on Tuesdays', IDENTICAL_A);
    // Textually unrelated to idA (no shared trigrams worth mentioning) — only the (manually
    // pinned) embedding says these are near-identical, so only the embedding tier can catch this.
    const idB = await seedMemory(userId, bucketId, 'Quarterly revenue grew twelve percent year over year', IDENTICAL_A);

    await duplicateDetectionService.run(userId, idA);

    const pairs = await pendingDuplicatePairs(userId);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].memoryIdA, pairs[0].memoryIdB].sort()).toEqual([idA, idB].sort());
  });

  it('flags nothing for a pair that is neither textually nor semantically similar', async () => {
    const { userId, bucketId } = await seedAccount('layered-none@example.com');
    const idA = await seedMemory(userId, bucketId, 'I love hiking in the mountains every summer', ORTHOGONAL_A);
    await seedMemory(userId, bucketId, 'Quarterly revenue grew twelve percent year over year', ORTHOGONAL_B);

    await duplicateDetectionService.run(userId, idA);

    expect(await pendingDuplicatePairs(userId)).toHaveLength(0);
  });

  it('does not re-flag a pair the exact tier already suggested (dedup unaffected by layering)', async () => {
    const { userId, bucketId } = await seedAccount('layered-dedup@example.com');
    const idA = await seedMemory(userId, bucketId, 'Same content here', ORTHOGONAL_A);
    await seedMemory(userId, bucketId, 'same content here', ORTHOGONAL_B);

    await duplicateDetectionService.run(userId, idA);
    await duplicateDetectionService.run(userId, idA);

    expect(await pendingDuplicatePairs(userId)).toHaveLength(1);
  });
});
