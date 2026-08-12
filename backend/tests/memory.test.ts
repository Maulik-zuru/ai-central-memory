import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';

const app = createApp();

// One disconnect for the whole file, at top level: a per-describe afterAll(disconnect) tears down
// the Prisma connection as soon as the FIRST describe finishes, and every later describe in the
// file then fails with "Engine is not yet connected" (see tests/compliance.test.ts).
afterAll(disconnect);

describe('Memory CRUD & versioning (US-MEM-01, 04, 08, 09)', () => {
  beforeEach(resetDb);

  it('rejects empty content', async () => {
    const token = await registerAndGetToken(app, 'ada@example.com');
    const res = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('creates a memory and queues embedding without blocking the response', async () => {
    const token = await registerAndGetToken(app, 'grace@example.com');
    const res = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'I prefer TypeScript strict mode.' });

    expect(res.status).toBe(201);
    expect(res.body.memory.content).toBe('I prefer TypeScript strict mode.');

    // The response already returned — embedding happens after, asynchronously.
    const withEmbedding = await waitFor(async () => {
      const rows = await prisma.$queryRaw<{ has_embedding: boolean }[]>`
        SELECT embedding IS NOT NULL AS has_embedding FROM "Memory" WHERE id = ${res.body.memory.id}
      `;
      return rows[0]?.has_embedding || undefined;
    });
    expect(withEmbedding).toBe(true);
  });

  it('one-click save returns quickly with the exact text, no rewriting', async () => {
    const token = await registerAndGetToken(app, 'turing@example.com');
    const text = 'Ships every Friday, two-person studio.';
    const start = Date.now();
    const res = await request(app).post('/api/memories/one-click').set('Authorization', `Bearer ${token}`).send({ content: text });
    expect(res.status).toBe(201);
    expect(res.body.memory.content).toBe(text);
    expect(res.body.memory.source).toBe('one_click');
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('editing a memory creates a new version and never overwrites without one', async () => {
    const token = await registerAndGetToken(app, 'lovelace@example.com');
    const created = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content: 'v1' });
    const id = created.body.memory.id;

    await request(app).patch(`/api/memories/${id}`).set('Authorization', `Bearer ${token}`).send({ content: 'v2' });

    const versions = await request(app).get(`/api/memories/${id}/versions`).set('Authorization', `Bearer ${token}`);
    expect(versions.body.versions.map((v: { content: string }) => v.content)).toEqual(['v1', 'v2']);
  });

  it('deleting a memory excludes it from the list and detail endpoints immediately', async () => {
    const token = await registerAndGetToken(app, 'hopper@example.com');
    const created = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content: 'temp' });
    const id = created.body.memory.id;

    const del = await request(app).delete(`/api/memories/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/api/memories/${id}`).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(404);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(0);
  });

  it('paginates by cursor without skipping or duplicating rows across pages', async () => {
    const token = await registerAndGetToken(app, 'curie@example.com');
    for (let i = 0; i < 25; i++) {
      await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content: `memory ${i}` });
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await request(app)
        .get('/api/memories')
        .query({ limit: 10, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${token}`);
      for (const item of res.body.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(25);
    expect(pages).toBe(3);
  });
});

describe('Memory search — GET /api/memories/search (US-INT-03a/b)', () => {
  beforeEach(resetDb);

  async function createMemoryWithEmbedding(token: string, content: string, bucketId?: string) {
    const res = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .send(bucketId ? { content, bucketId } : { content });
    const id = res.body.memory.id as string;
    await waitFor(async () => {
      const rows = await prisma.$queryRaw<{ has_embedding: boolean }[]>`
        SELECT embedding IS NOT NULL AS has_embedding FROM "Memory" WHERE id = ${id}
      `;
      return rows[0]?.has_embedding || undefined;
    });
    return id;
  }

  it('ranks a matching memory above an unrelated one', async () => {
    const token = await registerAndGetToken(app, 'search-a@example.com');
    const matchId = await createMemoryWithEmbedding(token, 'I go running every morning before work.');
    await createMemoryWithEmbedding(token, 'My favorite recipe calls for saffron and slow-roasted lamb.');

    const res = await request(app)
      .get('/api/memories/search')
      .query({ query: 'What is my running routine?' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe(matchId);
  });

  it('403s a search scoped to a bucket the caller is not at least a viewer on', async () => {
    const ownerToken = await registerAndGetToken(app, 'search-owner@example.com');
    const outsiderToken = await registerAndGetToken(app, 'search-outsider@example.com');
    const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${ownerToken}`);
    const bucketId = buckets.body.buckets[0].id as string;

    const res = await request(app)
      .get('/api/memories/search')
      .query({ query: 'anything', bucketId })
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });

  it('rejects an empty query', async () => {
    const token = await registerAndGetToken(app, 'search-empty@example.com');
    const res = await request(app).get('/api/memories/search').query({ query: '' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
