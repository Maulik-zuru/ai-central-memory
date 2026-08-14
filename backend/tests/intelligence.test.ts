import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { graphService } from '../src/modules/intelligence/graph.service';
import { analyticsService } from '../src/modules/intelligence/analytics.service';

const app = createApp();

// One disconnect for the whole file, at top level: a per-describe afterAll(disconnect) tears down
// the Prisma connection as soon as the FIRST describe finishes, and every later describe in the
// file then fails with "Engine is not yet connected" (see tests/compliance.test.ts).
afterAll(disconnect);

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

async function makePro(userId: string) {
  await prisma.subscription.update({ where: { userId }, data: { plan: 'pro' } });
}

async function createMemory(token: string, content: string, bucketId?: string) {
  const res = await request(app)
    .post('/api/memories')
    .set('Authorization', `Bearer ${token}`)
    .send({ content, ...(bucketId ? { bucketId } : {}) });
  const id = res.body.memory.id as string;
  await waitFor(() =>
    prisma
      .$queryRaw<{ embedded: boolean }[]>`SELECT (embedding IS NOT NULL) AS embedded FROM "Memory" WHERE id = ${id}`
      .then((rows) => (rows[0]?.embedded ? rows[0] : undefined)),
  );
  return id;
}

function chatGptExport(text: string, title: string) {
  return Buffer.from(
    JSON.stringify([
      {
        title,
        current_node: 'n0',
        mapping: {
          root: { id: 'root', message: null, parent: null, children: ['n0'] },
          n0: {
            id: 'n0',
            message: { author: { role: 'user' }, content: { content_type: 'text', parts: [text] }, create_time: 1700000000 },
            parent: 'root',
            children: [],
          },
        },
      },
    ]),
  );
}

async function importConversation(token: string, bucketId: string, text: string, title: string) {
  const res = await request(app)
    .post('/api/chat-history/import')
    .set('Authorization', `Bearer ${token}`)
    .field('bucketId', bucketId)
    .field('platform', 'chatgpt')
    .attach('file', chatGptExport(text, title), 'export.json');
  expect(res.status).toBe(202);
  return waitFor(() =>
    prisma.conversation.findFirst({ where: { bucketId, title } }).then((c) => (c?.status === 'ready' ? c : undefined)),
  );
}

describe('Phase 9: Knowledge graph (US-ADV-02)', () => {
  beforeEach(resetDb);

  it('links two entities mentioned together in a memory, attributed to that memory', async () => {
    const { userId, token } = await seedAccount('graph-a@example.com');
    await makePro(userId);
    const memoryId = await createMemory(token, 'we are building Project X for Client A this quarter.');

    await graphService.extractForMemory(memoryId);

    const nodes = await prisma.knowledgeGraphNode.findMany({ where: { userId } });
    const names = nodes.map((n) => n.normalizedName).sort();
    expect(names).toEqual(['client a', 'project x']);

    const edges = await prisma.knowledgeGraphEdge.findMany({ where: { userId } });
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceMemoryId).toBe(memoryId);
    expect(edges[0].sourceMessageId).toBeNull();
  });

  it('resolves the same entity mentioned across two memories to one node, not two', async () => {
    const { userId, token } = await seedAccount('graph-b@example.com');
    await makePro(userId);
    const memory1 = await createMemory(token, 'we are building Project X for Client A this quarter.');
    const memory2 = await createMemory(token, 'the roadmap for Project X slipped by a week.');

    await graphService.extractForMemory(memory1);
    await graphService.extractForMemory(memory2);

    const projectXNodes = await prisma.knowledgeGraphNode.findMany({
      where: { userId, normalizedName: 'project x' },
    });
    expect(projectXNodes).toHaveLength(1);
  });

  it('attributes an edge extracted from a conversation message to that message, not a memory', async () => {
    const { userId, token, bucketId } = await seedAccount('graph-c@example.com');
    await makePro(userId);
    const conversation = await importConversation(
      token,
      bucketId,
      'we chose Postgres for the Analytics Pipeline project.',
      'DB decision',
    );
    const message = await prisma.message.findFirst({ where: { conversationId: conversation!.id } });

    await graphService.extractForMessage(message!.id);

    const edges = await prisma.knowledgeGraphEdge.findMany({ where: { userId } });
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      const hasMemorySource = edge.sourceMemoryId !== null;
      const hasMessageSource = edge.sourceMessageId !== null;
      expect(hasMemorySource !== hasMessageSource).toBe(true); // exactly one is set
    }
    expect(edges.some((e) => e.sourceMessageId === message!.id)).toBe(true);
  });

  it('never includes nodes whose only source memory is outside the requested bucket', async () => {
    const { userId, token } = await seedAccount('graph-d@example.com');
    await makePro(userId);
    const bucketsRes = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
    const bucketA = bucketsRes.body.buckets[0].id as string;
    const createBucketRes = await request(app)
      .post('/api/buckets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bucket B' });
    const bucketB = createBucketRes.body.bucket.id as string;

    const memoryInA = await createMemory(token, 'Project Falcon is scoped for Client North.', bucketA);
    const memoryInB = await createMemory(token, 'Project Comet is scoped for Client South.', bucketB);
    await graphService.extractForMemory(memoryInA);
    await graphService.extractForMemory(memoryInB);

    const graphA = await graphService.getGraph(userId, { bucketId: bucketA });
    const namesInA = graphA.nodes.map((n) => n.name);
    expect(namesInA).toEqual(expect.arrayContaining(['Project Falcon', 'Client North']));
    expect(namesInA).not.toEqual(expect.arrayContaining(['Project Comet']));
    expect(namesInA).not.toEqual(expect.arrayContaining(['Client South']));
  });

  it('403s a Core-plan user on all three intelligence endpoints; a Pro-plan user succeeds', async () => {
    const { userId, token } = await seedAccount('graph-e@example.com');

    for (const path of ['/api/intelligence/graph', '/api/intelligence/usage', '/api/intelligence/insights']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRO_FEATURE');
    }

    await makePro(userId);

    for (const path of ['/api/intelligence/graph', '/api/intelligence/usage', '/api/intelligence/insights']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }
  });
});

describe('Phase 9: Usage analytics (US-ADV-03)', () => {
  beforeEach(resetDb);

  it('rollupForUser matches a hand-computed expectation for a scripted sequence of real actions', async () => {
    const { userId, token, bucketId } = await seedAccount('usage-a@example.com');
    await makePro(userId);

    await createMemory(token, 'the launch date moved to next Friday.');

    await importConversation(token, bucketId, 'we chose Postgres with pgvector for search.', 'sync test');

    const previewRes = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'launch date search' });
    expect(previewRes.status).toBe(200);
    const expectedTokensSaved = previewRes.body.everythingTokens - previewRes.body.actualTokens;

    const askRes = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'when did the launch date move?', mode: 'all' });
    expect(askRes.status).toBe(200);

    // record() is fire-and-forget — give its inserts a moment to land before rolling up.
    await waitFor(() =>
      prisma.usageAnalyticsEvent.count({ where: { userId } }).then((n) => (n >= 4 ? n : undefined)),
    );

    const period = analyticsService.monthKey(new Date());
    await analyticsService.rollupForUser(userId, period);
    const usage = await analyticsService.getUsage(userId, period);

    expect(usage).toEqual(
      expect.objectContaining({
        memoriesCreated: 1,
        askQueries: 1,
        syncsCompleted: 1,
        tokensSaved: expectedTokensSaved,
      }),
    );
  });

  it('exposes the rolled-up summary through GET /api/intelligence/usage for a Pro user', async () => {
    const { userId, token } = await seedAccount('usage-b@example.com');
    await makePro(userId);
    await createMemory(token, 'a fact worth remembering.');
    await waitFor(() => prisma.usageAnalyticsEvent.count({ where: { userId } }).then((n) => (n >= 1 ? n : undefined)));

    const period = analyticsService.monthKey(new Date());
    await analyticsService.rollupForUser(userId, period);

    const res = await request(app).get('/api/intelligence/usage').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.usage.memoriesCreated).toBe(1);
  });
});
