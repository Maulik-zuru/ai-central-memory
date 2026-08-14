import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { toVectorLiteral } from '../src/shared/vector';
import { getLlmProvider, __setLlmProviderForTests, EMBEDDING_DIMENSIONS } from '../src/shared/providers/llm.provider';
import { curatorService } from '../src/modules/memory/curator.service';

// Phase 19 (ADR-0004 "unify duplicate-detection and stale-detection into one Memory Suggestions
// curator"): replaces the old duplicate-detection.service.ts/stale-detection.service.ts tests —
// same layered-matching guarantee (Phase 18.4) now lives inside one curator pass, plus the new
// combine/update write paths and the mandatory ID-revalidation safeguard ADR-0004 calls for.

const app = createApp();
afterAll(disconnect);

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

async function createMemory(token: string, content: string) {
  const res = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content });
  const id = res.body.memory.id as string;
  await waitFor(() =>
    prisma
      .$queryRaw<{ e: boolean }[]>`SELECT (embedding IS NOT NULL) AS e FROM "Memory" WHERE id = ${id}`
      .then((rows) => (rows[0]?.e ? rows[0] : undefined)),
  );
  return id;
}

async function waitForSuggestion(userId: string, type: string) {
  return waitFor(() => prisma.memorySuggestion.findFirst({ where: { userId, type, status: 'pending' } }));
}

function unitVector(dim: number): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[dim] = 1;
  return v;
}

async function seedMemoryWithEmbedding(userId: string, bucketId: string, content: string, embedding: number[], createdAt?: Date) {
  const memory = await prisma.memory.create({
    data: {
      userId, bucketId, type: 'text', content, source: 'manual', ...(createdAt ? { createdAt } : {}),
      versions: { create: { content, changedBy: userId, changeType: 'create' } },
    },
  });
  await prisma.$executeRaw`UPDATE "Memory" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${memory.id}`;
  return memory.id;
}

describe('Curator — exact/fuzzy short-circuit (Phase 18.4 preserved)', () => {
  beforeEach(resetDb);

  it('proposes "remove" for an exact case-insensitive match without ever running the embedding-distance query', async () => {
    const { userId, bucketId } = await seedAccount('curator-exact@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'I deploy to Railway now', unitVector(0));
    const idB = await seedMemoryWithEmbedding(userId, bucketId, 'i deploy to railway now', unitVector(1));

    const querySpy = jest.spyOn(prisma, '$queryRaw');
    await curatorService.run(userId, idA);
    const ranEmbeddingDistanceQuery = querySpy.mock.calls.some((call) =>
      Array.from(call[0] as unknown as TemplateStringsArray).join('').includes('<=>'),
    );
    querySpy.mockRestore();
    expect(ranEmbeddingDistanceQuery).toBe(false);

    const suggestion = await prisma.memorySuggestion.findFirst({ where: { userId, type: 'remove' } });
    expect(suggestion).toBeTruthy();
    expect(suggestion!.memoryIds).toContain(idA);
    expect(suggestion!.memoryIds).toContain(idB);
  });

  it('proposes "remove" for a near-identical (punctuation-only) pair via the fuzzy tier, targeting the newer memory', async () => {
    const { token, bucketId } = await seedAccount('curator-fuzzy@example.com');
    await createMemory(token, 'We ship every Friday afternoon.');
    const newerId = await createMemory(token, 'We ship every Friday afternoon');

    const suggestion = await waitFor(() => prisma.memorySuggestion.findFirst({ where: { type: 'remove', status: 'pending' } }));
    expect(suggestion.memoryIds[0]).toBe(newerId);
  });
});

describe('Curator — embedding-tier ambiguous clusters (Phase 19, ADR-0004)', () => {
  beforeEach(resetDb);

  it('proposes "update" for a genuine contradiction, rewriting the older memory to the newer content', async () => {
    const { userId, bucketId } = await seedAccount('curator-update@example.com');
    const olderId = await seedMemoryWithEmbedding(
      userId, bucketId, 'I live in Berlin and work as a software engineer.', unitVector(2),
      new Date(Date.now() - 2 * 86_400_000),
    );
    const newerId = await seedMemoryWithEmbedding(
      userId, bucketId, 'I now live in Lisbon and work as a software engineer.', unitVector(2),
    );

    await curatorService.run(userId, newerId);

    const suggestion = await prisma.memorySuggestion.findFirst({ where: { userId, type: 'update' } });
    expect(suggestion).toBeTruthy();
    expect(suggestion!.memoryIds).toEqual([olderId]);
    expect(suggestion!.draftContent).toContain('Lisbon');
  });

  it('approving an "update" suggestion rewrites the target memory content via a new MemoryVersion', async () => {
    const { token, userId, bucketId } = await seedAccount('curator-update-approve@example.com');
    const olderId = await seedMemoryWithEmbedding(
      userId, bucketId, 'I live in Berlin and work as a software engineer.', unitVector(2),
      new Date(Date.now() - 2 * 86_400_000),
    );
    const newerId = await seedMemoryWithEmbedding(userId, bucketId, 'I now live in Lisbon and work as a software engineer.', unitVector(2));
    await curatorService.run(userId, newerId);

    const suggestion = await waitForSuggestion(userId, 'update');
    const approve = await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const updated = await prisma.memory.findUnique({ where: { id: olderId } });
    expect(updated?.content).toContain('Lisbon');

    const versions = await prisma.memoryVersion.findMany({ where: { memoryId: olderId }, orderBy: { createdAt: 'asc' } });
    expect(versions.length).toBeGreaterThan(1);
    expect(versions[versions.length - 1].content).toContain('Lisbon');
  });

  it('proposes "combine" for related-but-not-contradicting memories', async () => {
    const { userId, bucketId } = await seedAccount('curator-combine@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'My favorite programming language is Python.', unitVector(3));
    const idB = await seedMemoryWithEmbedding(userId, bucketId, 'My favorite programming language is also Rust.', unitVector(3));

    await curatorService.run(userId, idB);

    const suggestion = await prisma.memorySuggestion.findFirst({ where: { userId, type: 'combine' } });
    expect(suggestion).toBeTruthy();
    expect(suggestion!.memoryIds.sort()).toEqual([idA, idB].sort());
    expect(suggestion!.draftContent).toContain('Python');
    expect(suggestion!.draftContent).toContain('Rust');
  });

  it('a 3-memory combine preserves a date, a quantity, and a since-X timestamp across the merge', async () => {
    const { token, userId, bucketId } = await seedAccount('curator-combine-3way@example.com');
    const real = getLlmProvider();
    const FIXED = unitVector(4);
    __setLlmProviderForTests({ ...real, embed: async () => FIXED });

    await createMemory(token, 'Signed up for the gym on March 3rd, membership costs 45 dollars per month.');
    await createMemory(token, 'Started attending gym classes since 2023, currently doing 3 sessions a week.');
    await createMemory(token, 'Gym membership ID is GM-4471, still going as of this month.');

    // Each memory's own creation independently triggers the curator, so a smaller (e.g. 2-way)
    // combine proposal may already exist by the time the third memory's own cluster — everything
    // seen so far — produces the full 3-way one; scan every pending combine for that specific one
    // (findFirst would deterministically keep re-matching the same smaller suggestion instead).
    const suggestion = await waitFor(() =>
      prisma.memorySuggestion
        .findMany({ where: { userId, type: 'combine', status: 'pending' } })
        .then((rows) => rows.find((s) => s.memoryIds.length === 3)),
    );
    expect(suggestion.memoryIds.length).toBe(3);
    expect(suggestion.draftContent).toContain('March 3rd');
    expect(suggestion.draftContent).toContain('45 dollars');
    expect(suggestion.draftContent).toContain('since 2023');
    expect(suggestion.draftContent).toContain('GM-4471');

    const approve = await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(1);
    const survivor = list.body.items[0];
    expect(survivor.content).toContain('March 3rd');
    expect(survivor.content).toContain('45 dollars');
    expect(survivor.content).toContain('since 2023');
    expect(survivor.content).toContain('GM-4471');

    __setLlmProviderForTests(null);
  });

  it('proposes nothing for genuinely unrelated memories', async () => {
    const { userId, bucketId } = await seedAccount('curator-none@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'I love hiking in the mountains every summer.', unitVector(5));
    await seedMemoryWithEmbedding(userId, bucketId, 'Quarterly revenue grew twelve percent year over year.', unitVector(5));

    await curatorService.run(userId, idA);

    expect(await prisma.memorySuggestion.count({ where: { userId } })).toBe(0);
  });
});

describe('Curator — mandatory ID-revalidation (adversarial, ADR-0004)', () => {
  beforeEach(resetDb);
  afterEach(() => __setLlmProviderForTests(null));

  it('never creates a suggestion when the model proposes "remove" for an id outside the cluster', async () => {
    const { userId, bucketId } = await seedAccount('curator-adversarial-remove@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from the office on Tuesdays.', unitVector(6));
    await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from home on Fridays sometimes.', unitVector(6));

    const real = getLlmProvider();
    __setLlmProviderForTests({ ...real, proposeCuratorAction: async () => ({ action: 'remove', memoryId: 'fabricated-id-not-in-cluster' }) });

    await curatorService.run(userId, idA);
    expect(await prisma.memorySuggestion.count({ where: { userId } })).toBe(0);
  });

  it('never creates a suggestion when the model proposes "update" for an id outside the cluster', async () => {
    const { userId, bucketId } = await seedAccount('curator-adversarial-update@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from the office on Tuesdays.', unitVector(6));
    await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from home on Fridays sometimes.', unitVector(6));

    const real = getLlmProvider();
    __setLlmProviderForTests({
      ...real,
      proposeCuratorAction: async () => ({ action: 'update', memoryId: 'fabricated-id-not-in-cluster', content: 'hallucinated rewrite' }),
    });

    await curatorService.run(userId, idA);
    expect(await prisma.memorySuggestion.count({ where: { userId } })).toBe(0);
  });

  it('never creates a suggestion when a "combine" proposal mixes a real cluster id with a fabricated one', async () => {
    const { userId, bucketId } = await seedAccount('curator-adversarial-combine@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from the office on Tuesdays.', unitVector(6));
    const idB = await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from home on Fridays sometimes.', unitVector(6));

    const real = getLlmProvider();
    __setLlmProviderForTests({
      ...real,
      proposeCuratorAction: async () => ({ action: 'combine', memoryIds: [idA, idB, 'fabricated-id-not-in-cluster'], content: 'merged text' }),
    });

    await curatorService.run(userId, idA);
    expect(await prisma.memorySuggestion.count({ where: { userId } })).toBe(0);
  });

  it('rejects a "combine" proposal naming fewer than two memories', async () => {
    const { userId, bucketId } = await seedAccount('curator-adversarial-combine-solo@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from the office on Tuesdays.', unitVector(6));
    await seedMemoryWithEmbedding(userId, bucketId, 'I prefer working from home on Fridays sometimes.', unitVector(6));

    const real = getLlmProvider();
    __setLlmProviderForTests({ ...real, proposeCuratorAction: async () => ({ action: 'combine', memoryIds: [idA], content: 'merged text' }) });

    await curatorService.run(userId, idA);
    expect(await prisma.memorySuggestion.count({ where: { userId } })).toBe(0);
  });
});

describe('Curator — 10,000-token skip (MemoryPlugin_Clone_Spec.md §5.2)', () => {
  beforeEach(resetDb);

  it('never analyzes (or gets analyzed against) a memory whose content exceeds 10,000 tokens', async () => {
    const { userId, bucketId } = await seedAccount('curator-token-skip@example.com');
    const hugeContent = 'word '.repeat(15_000);
    const hugeId = await seedMemoryWithEmbedding(userId, bucketId, hugeContent, unitVector(7));
    await seedMemoryWithEmbedding(userId, bucketId, 'word '.repeat(15_000), unitVector(7));

    await curatorService.run(userId, hugeId);
    expect(await prisma.memorySuggestion.count({ where: { userId } })).toBe(0);
  });
});

describe('Curator — approve/dismiss REST flows for remove and combine', () => {
  beforeEach(resetDb);

  it('approving a "remove" suggestion soft-deletes the target memory', async () => {
    const { token, bucketId } = await seedAccount('curator-remove-approve@example.com');
    await createMemory(token, 'We ship every Friday afternoon.');
    const newerId = await createMemory(token, 'We ship every Friday afternoon');

    const suggestion = await waitFor(() => prisma.memorySuggestion.findFirst({ where: { type: 'remove', status: 'pending' } }));
    const approve = await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const memory = await prisma.memory.findUnique({ where: { id: newerId } });
    expect(memory?.status).toBe('deleted');
  });

  it('dismissing a "remove" suggestion leaves both memories active and never re-flags the pair', async () => {
    const { token, userId, bucketId } = await seedAccount('curator-remove-dismiss@example.com');
    await createMemory(token, 'We ship every Friday afternoon.');
    await createMemory(token, 'We ship every Friday afternoon');

    const suggestion = await waitFor(() => prisma.memorySuggestion.findFirst({ where: { type: 'remove', status: 'pending' } }));
    await request(app).post(`/api/suggestions/${suggestion.id}/dismiss`).set('Authorization', `Bearer ${token}`);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(2);

    const memories = await prisma.memory.findMany({ where: { userId, status: 'active' } });
    await curatorService.run(userId, memories[0].id);
    expect(await prisma.memorySuggestion.count({ where: { userId, type: 'remove', status: 'pending' } })).toBe(1);
  });

  it('approving a "combine" suggestion merges every named memory into the survivor and preserves version history', async () => {
    const { token, userId, bucketId } = await seedAccount('curator-combine-approve@example.com');
    const idA = await seedMemoryWithEmbedding(userId, bucketId, 'My favorite programming language is Python.', unitVector(3));
    const idB = await seedMemoryWithEmbedding(userId, bucketId, 'My favorite programming language is also Rust.', unitVector(3));

    await curatorService.run(userId, idB);
    const suggestion = await waitForSuggestion(userId, 'combine');
    const survivorId = suggestion.memoryIds[0];
    const absorbedId = suggestion.memoryIds.find((id) => id !== survivorId)!;

    const approve = await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const survivor = await prisma.memory.findUnique({ where: { id: survivorId } });
    expect(survivor?.content).toContain('Python');
    expect(survivor?.content).toContain('Rust');

    const absorbed = await prisma.memory.findUnique({ where: { id: absorbedId } });
    expect(absorbed?.status).toBe('merged');
    expect(absorbed?.mergedIntoId).toBe(survivorId);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(1);
  });
});
