import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';

const app = createApp();

describe('Memory CRUD & versioning (US-MEM-01, 04, 08, 09)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

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
