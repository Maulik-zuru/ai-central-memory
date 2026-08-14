import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { retrievalService } from '../src/modules/context/retrieval.service';
import { __resetCacheProviderForTests } from '../src/shared/providers/cache.provider';
import { stubOutbox, clearStubOutbox } from '../src/shared/providers/email.provider';
import { toVectorLiteral } from '../src/shared/vector';
import {
  MIN_MEMORIES_TO_CATEGORIZE,
  MAX_MEMORIES_TO_CATEGORIZE,
  MAX_TOKENS_TO_CATEGORIZE,
} from '../src/modules/category/categorization-batch.service';

const app = createApp();

// One disconnect for the whole file, at top level: a per-describe afterAll(disconnect) tears down
// the Prisma connection as soon as the FIRST describe finishes, and every later describe in the
// file then fails with "Engine is not yet connected" (see tests/compliance.test.ts).
afterAll(disconnect);

async function createMemory(token: string, content: string, bucketId?: string) {
  const res = await request(app)
    .post('/api/memories')
    .set('Authorization', `Bearer ${token}`)
    .send(bucketId ? { content, bucketId } : { content });
  return res.body.memory.id as string;
}

async function waitForAllEmbedded(ids: string[]) {
  await waitFor(async () => {
    const rows = await prisma.$queryRaw<{ has_embedding: boolean }[]>`
      SELECT (embedding IS NOT NULL) AS has_embedding FROM "Memory" WHERE id IN (${Prisma.join(ids)})
    `;
    return (rows.length === ids.length && rows.every((r) => r.has_embedding)) || undefined;
  }, { timeoutMs: 15000 });
}

/** Bypasses the HTTP/embedding-provider round trip for the volume tests (2,000+ rows) — a fixed,
 * identical embedding is fine there since those tests only exercise the hard-gate count/token
 * checks, which run before clustering ever looks at embedding similarity. */
async function bulkSeedMemories(userId: string, bucketId: string, count: number, content: (i: number) => string) {
  await prisma.memory.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      bucketId,
      type: 'text',
      content: content(i),
      source: 'manual' as const,
      status: 'active',
    })),
  });
  const fakeEmbedding = toVectorLiteral(Array(1536).fill(0.1));
  await prisma.$executeRaw`
    UPDATE "Memory" SET embedding = ${fakeEmbedding}::vector WHERE "bucketId" = ${bucketId} AND embedding IS NULL
  `;
}

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string };
}

async function defaultBucketId(token: string): Promise<string> {
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return buckets.body.buckets[0].id as string;
}

async function setupSharedBucket(role: 'editor' | 'viewer') {
  const owner = await seedAccount('smart-owner@example.com');
  const memberToken = await registerAndGetToken(app, 'smart-member@example.com');
  const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${owner.token}`).send({ name: 'Shared' });
  const bucketId = bucket.body.bucket.id as string;

  await request(app)
    .post(`/api/buckets/${bucketId}/invites`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ email: 'smart-member@example.com', role });
  const rawToken = stubOutbox[0].html.match(/invites\/([a-f0-9]+)/)?.[1];
  await request(app).post(`/api/invites/${rawToken}/accept`).set('Authorization', `Bearer ${memberToken}`);

  return { ownerToken: owner.token, ownerId: owner.userId, memberToken, bucketId };
}

describe('Smart Memory — batch categorization (Phase 20)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });

  it('a bucket under the minimum shows an honest "not enough memories yet" state, not a silent no-op', async () => {
    const { token } = await seedAccount('too-few@example.com');
    const bucketId = await defaultBucketId(token);
    for (let i = 0; i < 5; i++) await createMemory(token, `A short note number ${i}.`, bucketId);

    const res = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('too_few');
    expect(res.body.minimum).toBe(MIN_MEMORIES_TO_CATEGORIZE);
    expect(await prisma.category.count({ where: { bucketId } })).toBe(0);
  });

  it('a bucket over the memory-count ceiling is refused, not attempted and timed out', async () => {
    const { token, userId } = await seedAccount('too-many@example.com');
    const bucketId = await defaultBucketId(token);
    await bulkSeedMemories(userId, bucketId, MAX_MEMORIES_TO_CATEGORIZE + 1, (i) => `Bulk memory ${i}`);

    const res = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('too_large');
    expect(res.body.memoryCount).toBe(MAX_MEMORIES_TO_CATEGORIZE + 1);
    expect(await prisma.category.count({ where: { bucketId } })).toBe(0);
  }, 30000);

  it('a bucket over the token ceiling is refused even with well under 2,000 memories', async () => {
    const { token, userId } = await seedAccount('too-big-tokens@example.com');
    const bucketId = await defaultBucketId(token);
    const bigContent = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(3000); // ~24,000 tokens
    await bulkSeedMemories(userId, bucketId, MIN_MEMORIES_TO_CATEGORIZE, () => bigContent); // ~720k total for 30 memories, over the 600k ceiling

    const res = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId });

    expect(res.status).toBe(200);
    // Assert against the actual reported total rather than a re-derived guess — the point of this
    // test is "the ceiling is enforced", not "this test's own token-estimate arithmetic is exact".
    if (res.body.tokenCount > MAX_TOKENS_TO_CATEGORIZE) {
      expect(res.body.status).toBe('too_large');
    } else {
      // Content estimate landed under the ceiling — not what this test intends to exercise, so
      // fail loudly rather than silently passing on the wrong branch.
      throw new Error(`Test fixture produced ${res.body.tokenCount} tokens, under the ${MAX_TOKENS_TO_CATEGORIZE} ceiling — increase bigContent`);
    }
  }, 30000);

  it('a 30+-memory bucket categorizes into named categories with summary and additionalContext populated', async () => {
    const { token } = await seedAccount('categorize-batch@example.com');
    const bucketId = await defaultBucketId(token);

    const ids: string[] = [];
    for (let i = 0; i < 18; i++) {
      ids.push(await createMemory(token, `I enjoy backend systems programming task ${i} with Rust and Postgres internals.`, bucketId));
    }
    for (let i = 0; i < 15; i++) {
      ids.push(await createMemory(token, `My family recipe collection entry ${i} calls for saffron and slow-roasted lamb.`, bucketId));
    }
    await waitForAllEmbedded(ids);

    const res = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.categories.length).toBeGreaterThanOrEqual(2);
    for (const category of res.body.categories) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.summary.length).toBeGreaterThan(0);
      expect(category.additionalContext.length).toBeGreaterThan(0);
      expect(category.memoryCount).toBeGreaterThan(0);
    }
    const totalAssigned = res.body.categories.reduce((sum: number, c: { memoryCount: number }) => sum + c.memoryCount, 0);
    expect(totalAssigned).toBe(ids.length);

    const memories = await prisma.memory.findMany({ where: { id: { in: ids } } });
    expect(memories.every((m) => m.categoryId)).toBe(true);
  }, 30000);

  it('re-running recategorize replaces the previous categorization rather than adding to it', async () => {
    const { token } = await seedAccount('recategorize-twice@example.com');
    const bucketId = await defaultBucketId(token);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await createMemory(token, `A note about hiking trail number ${i} in the highlands.`, bucketId));
    await waitForAllEmbedded(ids);

    const first = await request(app).post('/api/categories/recategorize').set('Authorization', `Bearer ${token}`).send({ bucketId });
    expect(first.body.status).toBe('ok');
    const firstCategoryIds = first.body.categories.map((c: { id: string }) => c.id).sort();

    const second = await request(app).post('/api/categories/recategorize').set('Authorization', `Bearer ${token}`).send({ bucketId });
    expect(second.body.status).toBe('ok');

    const allCategories = await prisma.category.findMany({ where: { bucketId } });
    expect(allCategories.length).toBe(second.body.categories.length);
    expect(allCategories.map((c) => c.id).sort()).not.toEqual(firstCategoryIds);
  }, 30000);

  it('only the bucket owner can trigger recategorize — an editor is forbidden', async () => {
    const { memberToken, bucketId } = await setupSharedBucket('editor');
    const res = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ bucketId });
    expect(res.status).toBe(403);
  });

  it('never runs on a file bucket, even for its owner', async () => {
    const { token } = await seedAccount('file-bucket-owner@example.com');
    const fileBucket = await request(app)
      .post('/api/buckets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Uploads', type: 'file' });

    const res = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId: fileBucket.body.bucket.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_MEMORY_BUCKET');
  });
});

describe('Smart Memory — destructive reset (Phase 20)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });

  async function categorizedBucket(email: string) {
    const { token } = await seedAccount(email);
    const bucketId = await defaultBucketId(token);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await createMemory(token, `A reflection on gardening technique number ${i}.`, bucketId));
    await waitForAllEmbedded(ids);
    await request(app).post('/api/categories/recategorize').set('Authorization', `Bearer ${token}`).send({ bucketId });
    return { token, bucketId, ids };
  }

  it('rejects a reset without the exact confirmation phrase', async () => {
    const { token, bucketId } = await categorizedBucket('reset-no-confirm@example.com');
    const res = await request(app)
      .post('/api/categories/reset')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId, confirmation: 'reset' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await prisma.category.count({ where: { bucketId } })).toBeGreaterThan(0);
  });

  it('with the confirmation phrase, detaches every memory\'s category and is irreversible', async () => {
    const { token, bucketId, ids } = await categorizedBucket('reset-confirmed@example.com');

    const res = await request(app)
      .post('/api/categories/reset')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId, confirmation: 'RESET' });
    expect(res.status).toBe(204);

    expect(await prisma.category.count({ where: { bucketId } })).toBe(0);
    const memories = await prisma.memory.findMany({ where: { id: { in: ids } } });
    expect(memories.every((m) => m.categoryId === null)).toBe(true);

    const list = await request(app).get('/api/categories').query({ bucketId }).set('Authorization', `Bearer ${token}`);
    expect(list.body.categories).toEqual([]);
  });

  it('only the bucket owner can reset — an editor is forbidden', async () => {
    const owner = await seedAccount('reset-owner@example.com');
    const memberToken = await registerAndGetToken(app, 'reset-editor@example.com');
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${owner.token}`).send({ name: 'Shared' });
    const bucketId = bucket.body.bucket.id as string;
    await request(app)
      .post(`/api/buckets/${bucketId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: 'reset-editor@example.com', role: 'editor' });
    const rawToken = stubOutbox[0].html.match(/invites\/([a-f0-9]+)/)?.[1];
    await request(app).post(`/api/invites/${rawToken}/accept`).set('Authorization', `Bearer ${memberToken}`);

    const res = await request(app)
      .post('/api/categories/reset')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ bucketId, confirmation: 'RESET' });
    expect(res.status).toBe(403);
  });
});

describe('Smart Memory — bucket-scoped categories & category memories (US-INT-03a/b)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });

  async function categorizeBucket(token: string, bucketId: string, topics: string[][]) {
    const ids: string[] = [];
    for (const topic of topics) {
      for (const content of topic) ids.push(await createMemory(token, content, bucketId));
    }
    await waitForAllEmbedded(ids);
    const res = await request(app).post('/api/categories/recategorize').set('Authorization', `Bearer ${token}`).send({ bucketId });
    return { ids, categories: res.body.categories as { id: string }[] };
  }

  function topic(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, i) => `${prefix} entry number ${i} with distinguishing detail ${i}.`);
  }

  it('GET /api/categories?bucketId= only returns categories belonging to that bucket', async () => {
    const { token } = await seedAccount('mcp-categories@example.com');
    const defaultBucket = await defaultBucketId(token);
    const other = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Other bucket' });
    const otherBucketId = other.body.bucket.id as string;

    await categorizeBucket(token, defaultBucket, [topic('Deploying side projects to Railway', 18), topic('Family recipes with saffron', 15)]);
    await categorizeBucket(token, otherBucketId, [topic('Watercolor painting technique', 18), topic('Vintage synthesizer repair', 15)]);

    const scoped = await request(app)
      .get('/api/categories')
      .query({ bucketId: defaultBucket })
      .set('Authorization', `Bearer ${token}`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.categories.length).toBeGreaterThan(0);
    expect(scoped.body.categories.every((c: { bucketId: string }) => c.bucketId === defaultBucket)).toBe(true);
  }, 30000);

  it('403s a category listing scoped to a bucket the caller is not a member of', async () => {
    const { token: ownerToken } = await seedAccount('mcp-cat-owner@example.com');
    const { token: outsiderToken } = await seedAccount('mcp-cat-outsider@example.com');
    const bucketId = await defaultBucketId(ownerToken);

    const res = await request(app)
      .get('/api/categories')
      .query({ bucketId })
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/categories/:id/memories lists only that category\'s memories, cursor-paginated', async () => {
    const { token } = await seedAccount('mcp-cat-memories@example.com');
    const bucketId = await defaultBucketId(token);
    const { categories } = await categorizeBucket(token, bucketId, [
      topic('Deploying side projects to Railway', 18),
      topic('Family recipes with saffron', 15),
    ]);

    const res = await request(app)
      .get(`/api/categories/${categories[0].id}/memories`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((m: { categoryId: string }) => m.categoryId === categories[0].id)).toBe(true);
  }, 30000);

  it('403s a category memories lookup for a category the caller has no bucket access to', async () => {
    const { token: ownerToken } = await seedAccount('mcp-cat-mem-owner@example.com');
    const { token: outsiderToken } = await seedAccount('mcp-cat-mem-outsider@example.com');
    const bucketId = await defaultBucketId(ownerToken);
    const { categories } = await categorizeBucket(ownerToken, bucketId, [
      topic('Deploying side projects to Railway', 18),
      topic('Family recipes with saffron', 15),
    ]);

    const res = await request(app)
      .get(`/api/categories/${categories[0].id}/memories`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    // Phase 20 (ADR-0006): categories are bucket-scoped now, so access is the same
    // BUCKET_ACCESS_DENIED 403 every other bucket-scoped resource returns for a non-member —
    // no longer a 404 (the pre-Phase-20 model only ever checked exact category ownership, with
    // no shared-bucket access path at all).
    expect(res.status).toBe(403);
  }, 30000);

  it('renaming a category does not change its centroid, memoryCount, or any memory categoryId', async () => {
    const { token, userId } = await seedAccount('categorize-rename@example.com');
    const bucketId = await defaultBucketId(token);
    const { categories } = await categorizeBucket(token, bucketId, [
      topic('Deploying side projects to Railway', 18),
      topic('Family recipes with saffron', 15),
    ]);
    const categoryId = categories[0].id;

    const before = await prisma.category.findUnique({ where: { id: categoryId } });
    const centroidBefore = await prisma.$queryRaw<{ centroid: string }[]>`
      SELECT centroid::text FROM "Category" WHERE id = ${categoryId}
    `;

    // Category rename is Pro-only (Phase 10 retrofit) — a Core-plan attempt is blocked before it
    // ever reaches category.service.
    const blocked = await request(app)
      .patch(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Renamed Category' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PRO_FEATURE');

    await prisma.subscription.update({ where: { userId }, data: { plan: 'pro' } });

    const rename = await request(app)
      .patch(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Renamed Category' });
    expect(rename.status).toBe(200);
    expect(rename.body.category.label).toBe('Renamed Category');

    const after = await prisma.category.findUnique({ where: { id: categoryId } });
    const centroidAfter = await prisma.$queryRaw<{ centroid: string }[]>`
      SELECT centroid::text FROM "Category" WHERE id = ${categoryId}
    `;
    expect(after?.memoryCount).toBe(before?.memoryCount);
    expect(after?.bucketId).toBe(before?.bucketId);
    expect(centroidAfter[0]?.centroid).toEqual(centroidBefore[0]?.centroid);

    const list = await request(app).get('/api/categories').query({ bucketId }).set('Authorization', `Bearer ${token}`);
    expect(list.body.categories.some((c: { id: string; bucketId: string }) => c.id === categoryId && c.bucketId === bucketId)).toBe(true);
  }, 30000);
});

describe('Smart Memory — two-tier context retrieval (Phase 20)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });

  function topic(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, i) => `${prefix} entry number ${i} with distinguishing detail ${i}.`);
  }

  it('an uncategorized bucket still falls back to the flat scorer (no `categories` field)', async () => {
    const { token } = await seedAccount('two-tier-uncategorized@example.com');
    const bucketId = await defaultBucketId(token);
    await createMemory(token, 'I use Vim keybindings everywhere.', bucketId);

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'anything', bucketId });

    expect(res.status).toBe(200);
    expect(res.body.categories).toBeUndefined();
  });

  it('a categorized bucket returns every category as a tier-1 summary, expanding only the relevant one', async () => {
    const { token } = await seedAccount('two-tier-categorized@example.com');
    const bucketId = await defaultBucketId(token);

    const ids: string[] = [];
    for (const content of topic('I enjoy backend systems programming with Rust and Postgres internals', 18)) {
      ids.push(await createMemory(token, content, bucketId));
    }
    for (const content of topic('My family recipe collection calls for saffron and slow-roasted lamb', 15)) {
      ids.push(await createMemory(token, content, bucketId));
    }
    await waitForAllEmbedded(ids);
    const recategorized = await request(app)
      .post('/api/categories/recategorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId });
    expect(recategorized.body.status).toBe('ok');

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'What backend database do I prefer for systems programming?', bucketId, tokenBudget: 500 });

    expect(res.status).toBe(200);
    expect(res.body.categories.length).toBe(recategorized.body.categories.length);
    expect(res.body.categories.some((c: { expanded: boolean }) => c.expanded)).toBe(true);
    expect(res.body.categories.every((c: { summary: string; additionalContext: string }) => c.summary.length > 0 && c.additionalContext.length > 0)).toBe(true);
    // Only expanded categories' memories can appear in the flat list.
    const expandedIds = new Set(res.body.categories.filter((c: { expanded: boolean }) => c.expanded).map((c: { id: string }) => c.id));
    expect(res.body.memories.every((m: { categoryId: string }) => expandedIds.has(m.categoryId))).toBe(true);
    expect(res.body.actualTokens).toBeLessThanOrEqual(res.body.everythingTokens);
  }, 30000);

  it('turning Smart Mode off still returns the full unfiltered set even for a categorized bucket', async () => {
    const { token } = await seedAccount('two-tier-smart-off@example.com');
    const bucketId = await defaultBucketId(token);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await createMemory(token, `A note about a hobby number ${i}.`, bucketId));
    await waitForAllEmbedded(ids);
    await request(app).post('/api/categories/recategorize').set('Authorization', `Bearer ${token}`).send({ bucketId });

    await request(app).patch('/api/account/smart-memory').set('Authorization', `Bearer ${token}`).send({ enabled: false });

    const res = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'anything', bucketId });

    expect(res.status).toBe(200);
    expect(res.body.smartModeEnabled).toBe(false);
    expect(res.body.categories).toBeUndefined();
    expect(res.body.memories.length).toBe(ids.length);
  }, 30000);
});

describe('Smart Memory — context preview (US-ADV-01)', () => {
  beforeEach(resetDb);

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
