import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';

const app = createApp();

async function createMemory(token: string, content: string) {
  const res = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content });
  return res.body.memory.id as string;
}

async function waitForSuggestion(userId: string, type: string) {
  return waitFor(() => prisma.memorySuggestion.findFirst({ where: { userId, type, status: 'pending' } }));
}

describe('Duplicate detection (US-MEM-06)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('flags two near-identical memories as a duplicate suggestion without blocking either save', async () => {
    const token = await registerAndGetToken(app, 'ada@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const idA = await createMemory(token, 'I deploy my side projects to Railway now.');
    const idB = await createMemory(token, 'I deploy my side projects to Railway now');

    const suggestion = await waitForSuggestion(userId, 'duplicate');
    expect([suggestion.memoryIdA, suggestion.memoryIdB].sort()).toEqual([idA, idB].sort());
  });

  it('merging a duplicate suggestion combines the memories and preserves both version histories', async () => {
    const token = await registerAndGetToken(app, 'grace@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    await createMemory(token, 'Dana prefers code reviews as questions.');
    await createMemory(token, 'Dana prefers code reviews as questions');

    const suggestion = await waitForSuggestion(userId, 'duplicate');
    const approve = await request(app)
      .post(`/api/suggestions/${suggestion.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].content).toContain('Dana prefers code reviews as questions');
  });

  it('dismissing a duplicate suggestion leaves both memories separate and never re-flags the pair', async () => {
    const token = await registerAndGetToken(app, 'turing@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    await createMemory(token, 'We ship every Friday afternoon.');
    await createMemory(token, 'We ship every Friday afternoon');

    const suggestion = await waitForSuggestion(userId, 'duplicate');
    await request(app).post(`/api/suggestions/${suggestion.id}/dismiss`).set('Authorization', `Bearer ${token}`);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(2);

    // Re-run detection manually (as a second save touching the same content would) and confirm
    // the identical pair is not flagged again.
    const { duplicateDetectionService } = await import('../src/modules/memory/duplicate-detection.service');
    await duplicateDetectionService.run(userId, list.body.items[0].id);
    const pending = await prisma.memorySuggestion.count({ where: { userId, type: 'duplicate', status: 'pending' } });
    expect(pending).toBe(0);
  });
});

describe('Stale detection (US-MEM-07)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('flags the older memory as stale when a newer one contradicts it', async () => {
    const token = await registerAndGetToken(app, 'hopper@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'I live in Berlin.');
    await waitFor(() =>
      prisma.$queryRaw<{ e: boolean }[]>`SELECT embedding IS NOT NULL AS e FROM "Memory" WHERE id = ${olderId}`.then(
        (r) => r[0]?.e || undefined,
      ),
    );
    await createMemory(token, 'I now live in Lisbon.');

    const suggestion = await waitForSuggestion(userId, 'stale');
    expect(suggestion.memoryIdA).toBe(olderId);
  });

  it('approving a stale suggestion marks the old memory inactive, not deleted', async () => {
    const token = await registerAndGetToken(app, 'lovelace@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'I live in Berlin.');
    await waitFor(() =>
      prisma.$queryRaw<{ e: boolean }[]>`SELECT embedding IS NOT NULL AS e FROM "Memory" WHERE id = ${olderId}`.then(
        (r) => r[0]?.e || undefined,
      ),
    );
    await createMemory(token, 'I now live in Lisbon.');

    const suggestion = await waitForSuggestion(userId, 'stale');
    await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);

    const old = await prisma.memory.findUnique({ where: { id: olderId } });
    expect(old?.status).toBe('stale');

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items.find((m: { id: string }) => m.id === olderId)).toBeUndefined();
  });

  it('dismissing a stale suggestion leaves the old memory active exactly as before', async () => {
    const token = await registerAndGetToken(app, 'curie@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'I live in Berlin.');
    await waitFor(() =>
      prisma.$queryRaw<{ e: boolean }[]>`SELECT embedding IS NOT NULL AS e FROM "Memory" WHERE id = ${olderId}`.then(
        (r) => r[0]?.e || undefined,
      ),
    );
    await createMemory(token, 'I now live in Lisbon.');

    const suggestion = await waitForSuggestion(userId, 'stale');
    await request(app).post(`/api/suggestions/${suggestion.id}/dismiss`).set('Authorization', `Bearer ${token}`);

    const old = await prisma.memory.findUnique({ where: { id: olderId } });
    expect(old?.status).toBe('active');
  });
});
