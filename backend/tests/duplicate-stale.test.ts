import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';

const app = createApp();

// One disconnect for the whole file, at top level: a per-describe afterAll(disconnect) tears down
// the Prisma connection as soon as the FIRST describe finishes, and every later describe in the
// file then fails with "Engine is not yet connected" (see tests/compliance.test.ts).
afterAll(disconnect);

async function createMemory(token: string, content: string) {
  const res = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content });
  return res.body.memory.id as string;
}

async function waitForSuggestion(userId: string, type: string) {
  return waitFor(() => prisma.memorySuggestion.findFirst({ where: { userId, type, status: 'pending' } }));
}

describe('Duplicate detection (US-MEM-06)', () => {
  beforeEach(resetDb);

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

    const keepId = await createMemory(token, 'Dana prefers code reviews as questions.');
    const mergeId = await createMemory(token, 'Dana prefers code reviews as questions');

    const suggestion = await waitForSuggestion(userId, 'duplicate');
    const approve = await request(app)
      .post(`/api/suggestions/${suggestion.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);
    const survivorId = approve.body.suggestion?.memoryIdA ?? keepId;

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].content).toContain('Dana prefers code reviews as questions');

    // The absorbed memory keeps its own identity — a mergedIntoId trail, not just gone.
    const absorbedId = survivorId === keepId ? mergeId : keepId;
    const absorbed = await request(app).get(`/api/memories/${absorbedId}`).set('Authorization', `Bearer ${token}`);
    expect(absorbed.status).toBe(200);
    expect(absorbed.body.memory.status).toBe('merged');
    expect(absorbed.body.memory.mergedIntoId).toBe(survivorId);
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

describe('Stale detection (US-MEM-07) — replaces vs. extends (Phase 18.6, ADR-0003)', () => {
  beforeEach(resetDb);

  async function waitForEmbedded(memoryId: string) {
    return waitFor(() =>
      prisma
        .$queryRaw<{ e: boolean }[]>`SELECT embedding IS NOT NULL AS e FROM "Memory" WHERE id = ${memoryId}`
        .then((r) => r[0]?.e || undefined),
    );
  }

  it('flags a genuine contradiction as "replaces", not the old undifferentiated "stale" type', async () => {
    const token = await registerAndGetToken(app, 'hopper@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'I live in Berlin.');
    await waitForEmbedded(olderId);
    await createMemory(token, 'I now live in Lisbon.');

    const suggestion = await waitForSuggestion(userId, 'replaces');
    expect(suggestion.memoryIdA).toBe(olderId);
  });

  it('approving a "replaces" suggestion marks the old memory inactive and sets the new memory\'s supersedesId', async () => {
    const token = await registerAndGetToken(app, 'lovelace@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'I live in Berlin.');
    await waitForEmbedded(olderId);
    const newerId = await createMemory(token, 'I now live in Lisbon.');

    const suggestion = await waitForSuggestion(userId, 'replaces');
    await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);

    const old = await prisma.memory.findUnique({ where: { id: olderId } });
    expect(old?.status).toBe('stale');

    const newer = await prisma.memory.findUnique({ where: { id: newerId } });
    expect(newer?.supersedesId).toBe(olderId);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items.find((m: { id: string }) => m.id === olderId)).toBeUndefined();
    // supersedesId is walkable from the surviving memory's own public shape (ADR-0003's "walkable
    // both directions" consequence, exercised end to end via the REST layer, not just the ORM).
    expect(list.body.items.find((m: { id: string }) => m.id === newerId)?.supersedesId).toBe(olderId);
  });

  it('dismissing a "replaces" suggestion leaves the old memory active and sets no supersedesId', async () => {
    const token = await registerAndGetToken(app, 'curie@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'I live in Berlin.');
    await waitForEmbedded(olderId);
    const newerId = await createMemory(token, 'I now live in Lisbon.');

    const suggestion = await waitForSuggestion(userId, 'replaces');
    await request(app).post(`/api/suggestions/${suggestion.id}/dismiss`).set('Authorization', `Bearer ${token}`);

    const old = await prisma.memory.findUnique({ where: { id: olderId } });
    expect(old?.status).toBe('active');
    const newer = await prisma.memory.findUnique({ where: { id: newerId } });
    expect(newer?.supersedesId).toBeNull();
  });

  it('flags a mere addition as "extends", and approving it deactivates nothing', async () => {
    const token = await registerAndGetToken(app, 'franklin@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const userId = account.body.account.id as string;

    const olderId = await createMemory(token, 'My phone number is 555-1000.');
    await waitForEmbedded(olderId);
    // No contradiction cue ("now", "instead", "no longer", ...) — an addition, not a correction.
    const newerId = await createMemory(token, 'My work phone number is 555-2000.');

    const suggestion = await waitForSuggestion(userId, 'extends');
    expect([suggestion.memoryIdA, suggestion.memoryIdB].sort()).toEqual([olderId, newerId].sort());

    await request(app).post(`/api/suggestions/${suggestion.id}/approve`).set('Authorization', `Bearer ${token}`);

    const older = await prisma.memory.findUnique({ where: { id: olderId } });
    expect(older?.status).toBe('active');
    const newer = await prisma.memory.findUnique({ where: { id: newerId } });
    expect(newer?.status).toBe('active');
    expect(newer?.supersedesId).toBeNull();
  });
});
