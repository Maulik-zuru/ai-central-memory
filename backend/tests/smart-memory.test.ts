import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { retrievalService } from '../src/modules/context/retrieval.service';
import { __resetCacheProviderForTests } from '../src/shared/providers/cache.provider';

const app = createApp();

async function createMemory(token: string, content: string, bucketId?: string) {
  const res = await request(app)
    .post('/api/memories')
    .set('Authorization', `Bearer ${token}`)
    .send(bucketId ? { content, bucketId } : { content });
  return res.body.memory.id as string;
}

async function waitForCategorized(memoryId: string) {
  return waitFor(() =>
    prisma.memory.findUnique({ where: { id: memoryId } }).then((m) => (m?.categoryId ? m : undefined)),
  );
}

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string };
}

describe('Smart Memory — categorization (US-ADV-01)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('assigns a memory similar to an existing category centroid to it, and an unlike memory to a new category', async () => {
    const { token } = await seedAccount('categorize-a@example.com');

    const idA = await createMemory(token, 'I use TypeScript strict mode for every backend project.');
    await waitForCategorized(idA);
    const memoryA = await prisma.memory.findUnique({ where: { id: idA } });

    const idB = await createMemory(token, 'I use TypeScript strict mode for every backend service.');
    const memoryB = await waitForCategorized(idB);
    expect(memoryB.categoryId).toBe(memoryA?.categoryId);

    const idC = await createMemory(token, 'My favorite hiking trail is in the Scottish Highlands.');
    const memoryC = await waitForCategorized(idC);
    expect(memoryC.categoryId).not.toBe(memoryA?.categoryId);
  });

  it('stays stable across several similar memories in sequence instead of fragmenting into near-duplicate categories', async () => {
    const { token, userId } = await seedAccount('categorize-b@example.com');

    const contents = [
      'I prefer Postgres over MySQL for new projects.',
      'I prefer Postgres over MySQL for side projects.',
      'I prefer Postgres over MySQL when starting projects.',
    ];
    const ids: string[] = [];
    for (const content of contents) {
      ids.push(await createMemory(token, content));
    }
    for (const id of ids) await waitForCategorized(id);

    const categories = await prisma.category.findMany({ where: { userId } });
    const categoryIds = new Set((await prisma.memory.findMany({ where: { id: { in: ids } } })).map((m) => m.categoryId));

    expect(categoryIds.size).toBe(1);
    expect(categories.find((c) => c.id === [...categoryIds][0])?.memoryCount).toBe(3);
  });

  it('renaming a category does not change its centroid, memoryCount, or any memory categoryId', async () => {
    const { token, userId } = await seedAccount('categorize-c@example.com');
    const id = await createMemory(token, 'I always deploy side projects to Railway.');
    const memory = await waitForCategorized(id);

    const before = await prisma.category.findUnique({ where: { id: memory.categoryId! } });
    const centroidBefore = await prisma.$queryRaw<{ centroid: string }[]>`
      SELECT centroid::text FROM "Category" WHERE id = ${memory.categoryId}
    `;

    const rename = await request(app)
      .patch(`/api/categories/${memory.categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Deployment Preferences' });
    expect(rename.status).toBe(200);
    expect(rename.body.category.label).toBe('Deployment Preferences');

    const after = await prisma.category.findUnique({ where: { id: memory.categoryId! } });
    const centroidAfter = await prisma.$queryRaw<{ centroid: string }[]>`
      SELECT centroid::text FROM "Category" WHERE id = ${memory.categoryId}
    `;
    expect(after?.memoryCount).toBe(before?.memoryCount);
    expect(centroidAfter[0]?.centroid).toEqual(centroidBefore[0]?.centroid);

    const memoryAfter = await prisma.memory.findUnique({ where: { id } });
    expect(memoryAfter?.categoryId).toBe(memory.categoryId);

    const list = await request(app).get('/api/categories').set('Authorization', `Bearer ${token}`);
    expect(list.body.categories.some((c: { id: string; userId: string }) => c.id === memory.categoryId && c.userId === userId)).toBe(true);
  });
});

describe('Smart Memory — context preview (US-ADV-01)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('returns strictly fewer memories and a lower token count than the full scope, given 100+ seeded memories', async () => {
    const { token } = await seedAccount('preview-a@example.com');

    for (let i = 0; i < 60; i++) {
      await createMemory(token, `I enjoy backend systems programming task number ${i} with Rust and Postgres internals.`);
    }
    for (let i = 0; i < 50; i++) {
      await createMemory(token, `My family recipe collection entry ${i} calls for saffron and slow-roasted lamb.`);
    }

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'What backend database do I prefer for systems programming?', tokenBudget: 500 });

    expect(res.status).toBe(200);
    expect(res.body.memories.length).toBeGreaterThan(0);
    expect(res.body.memories.length).toBeLessThan(110);
    expect(res.body.actualTokens).toBeLessThan(res.body.everythingTokens);
  }, 30000);

  it('turning Smart Mode off returns the full unfiltered set from the same endpoint', async () => {
    const { token } = await seedAccount('preview-b@example.com');
    await createMemory(token, 'I use Vim keybindings everywhere.');
    await createMemory(token, 'My dog is a golden retriever named Biscuit.');

    const toggle = await request(app)
      .patch('/api/account/smart-memory')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });
    expect(toggle.status).toBe(200);
    expect(toggle.body.smartMemoryEnabled).toBe(false);

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.smartModeEnabled).toBe(false);
    expect(res.body.memories.length).toBe(2);
    expect(res.body.actualTokens).toBe(res.body.everythingTokens);
  });

  it('does not serve a stale cached preview across a Smart Mode toggle for the same snippet', async () => {
    const { token } = await seedAccount('preview-toggle-cache@example.com');
    await createMemory(token, 'I use Vim keybindings everywhere.');
    await createMemory(token, 'My dog is a golden retriever named Biscuit.', undefined);

    const body = { snippet: 'anything', tokenBudget: 1 };
    const before = await request(app).post('/api/context/preview').set('Authorization', `Bearer ${token}`).send(body);
    expect(before.body.smartModeEnabled).toBe(true);

    await request(app)
      .patch('/api/account/smart-memory')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });

    const after = await request(app).post('/api/context/preview').set('Authorization', `Bearer ${token}`).send(body);
    expect(after.body.smartModeEnabled).toBe(false);
    expect(after.body.memories.length).toBe(2);
  });

  it('returns a token count matching an independent tokenizer count of the returned content', async () => {
    const { countTokens } = await import('gpt-tokenizer');
    const { token } = await seedAccount('preview-c@example.com');
    await createMemory(token, 'I keep my notes in Obsidian with daily journaling.');

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'How do I take notes?' });

    const independentCount = res.body.memories.reduce(
      (sum: number, m: { content: string }) => sum + countTokens(m.content),
      0,
    );
    expect(res.body.actualTokens).toBe(independentCount);
  });

  it('403s a preview scoped to a bucket the caller is not at least a viewer on', async () => {
    const { token: tokenA } = await seedAccount('preview-owner@example.com');
    const { token: tokenB } = await seedAccount('preview-outsider@example.com');

    const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${tokenA}`);
    const bucketId = buckets.body.buckets[0].id as string;

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ snippet: 'anything', bucketId });

    expect(res.status).toBe(403);
  });

  it('serves two identical preview calls within the cache TTL from cache, without re-running the scoring query', async () => {
    __resetCacheProviderForTests();
    const spy = jest.spyOn(retrievalService, 'scoreCandidates');
    const { token } = await seedAccount('preview-cache@example.com');
    await createMemory(token, 'I run 5k every morning before work.');

    const body = { snippet: 'What is my exercise routine?' };
    const first = await request(app).post('/api/context/preview').set('Authorization', `Bearer ${token}`).send(body);
    const second = await request(app).post('/api/context/preview').set('Authorization', `Bearer ${token}`).send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    // Simulate TTL expiry (the real TTL is 60s — too slow to wait out in a unit test) via the same
    // test-only escape hatch llm.provider.ts already establishes for provider singletons.
    __resetCacheProviderForTests();
    const third = await request(app).post('/api/context/preview').set('Authorization', `Bearer ${token}`).send(body);
    expect(third.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });
});
