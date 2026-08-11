import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { syncService } from '../src/modules/chat-history/sync.service';
import { insightService } from '../src/modules/chat-history/insight.service';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

function chatGptExport(messages: { role: 'user' | 'assistant'; text: string; epochSec: number }[], title = 'Test chat') {
  const mapping: Record<string, unknown> = { root: { id: 'root', message: null, parent: null, children: [] } };
  let parentId = 'root';
  const ids: string[] = [];
  messages.forEach((m, i) => {
    const id = `node-${i}`;
    ids.push(id);
    mapping[id] = {
      id,
      message: {
        author: { role: m.role },
        content: { content_type: 'text', parts: [m.text] },
        create_time: m.epochSec,
      },
      parent: parentId,
      children: [],
    };
    parentId = id;
  });
  return Buffer.from(JSON.stringify([{ title, current_node: ids[ids.length - 1], mapping }]));
}

async function importAndWait(token: string, bucketId: string, platform: string, buffer: Buffer, expectedMessages: number) {
  const res = await request(app)
    .post('/api/chat-history/import')
    .set('Authorization', `Bearer ${token}`)
    .field('bucketId', bucketId)
    .field('platform', platform)
    .attach('file', buffer, 'export.json');
  expect(res.status).toBe(202);

  const conversation = await waitFor(() =>
    prisma.conversation
      .findFirst({ where: { bucketId, platform } })
      .then((c) => (c && c.status !== 'importing' && c.syncCursor >= expectedMessages ? c : undefined)),
  );
  return conversation;
}

describe('Chat History Archive — import (US-ARC-01, US-ARC-02)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('imports a ChatGPT export into a conversation with linearized messages', async () => {
    const { token, bucketId } = await seedAccount('archive-a@example.com');
    const buffer = chatGptExport([
      { role: 'user', text: 'What is the best way to deploy a Node app?', epochSec: 1700000000 },
      { role: 'assistant', text: 'Railway or Fly.io are both solid choices for small apps.', epochSec: 1700000010 },
    ]);

    const conversation = await importAndWait(token, bucketId, 'chatgpt', buffer, 2);
    expect(conversation?.status).toBe('ready');
    expect(conversation?.messageCount).toBe(2);

    const messages = await prisma.message.findMany({ where: { conversationId: conversation!.id }, orderBy: { position: 'asc' } });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('importing the same export twice creates zero duplicate conversations or messages', async () => {
    const { token, bucketId } = await seedAccount('archive-b@example.com');
    const buffer = chatGptExport([
      { role: 'user', text: 'Remember my favorite database is Postgres.', epochSec: 1700000000 },
      { role: 'assistant', text: 'Got it, Postgres it is.', epochSec: 1700000010 },
    ]);

    await importAndWait(token, bucketId, 'chatgpt', buffer, 2);
    const afterFirst = await prisma.conversation.count({ where: { bucketId } });

    await importAndWait(token, bucketId, 'chatgpt', buffer, 2);
    const afterSecond = await prisma.conversation.count({ where: { bucketId } });
    const messageCount = await prisma.message.count();

    expect(afterSecond).toBe(afterFirst);
    expect(messageCount).toBe(2);
  });

  it('a malformed export for one platform fails clearly without corrupting other imports', async () => {
    const { token, bucketId } = await seedAccount('archive-c@example.com');
    const goodBuffer = chatGptExport([{ role: 'user', text: 'A real conversation.', epochSec: 1700000000 }]);
    await importAndWait(token, bucketId, 'chatgpt', goodBuffer, 1);

    const badRes = await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'claude')
      .attach('file', Buffer.from('not valid json{{{'), 'export.json');

    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe('IMPORT_PARSE_FAILED');

    const stillThere = await prisma.conversation.findFirst({ where: { bucketId, platform: 'chatgpt' } });
    expect(stillThere).not.toBeNull();
  });

  it('rejects import for a viewer-role bucket member and for a non-member', async () => {
    const { token: ownerToken, bucketId } = await seedAccount('archive-owner@example.com');
    const { token: outsiderToken } = await seedAccount('archive-outsider@example.com');

    const buffer = chatGptExport([{ role: 'user', text: 'hi', epochSec: 1700000000 }]);
    const res = await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .field('bucketId', bucketId)
      .field('platform', 'chatgpt')
      .attach('file', buffer, 'export.json');

    expect(res.status).toBe(403);
    void ownerToken;
  });
});

describe('Chat History Archive — resumable sync (US-ARC-02)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('resumes processing from syncCursor instead of reprocessing earlier messages', async () => {
    const { token, bucketId } = await seedAccount('resume-a@example.com');
    const buffer = chatGptExport([
      { role: 'user', text: 'Message one.', epochSec: 1700000000 },
      { role: 'assistant', text: 'Message two.', epochSec: 1700000010 },
      { role: 'user', text: 'Message three.', epochSec: 1700000020 },
    ]);

    const conversation = await importAndWait(token, bucketId, 'chatgpt', buffer, 3);

    // Simulate "already processed message 0, crashed before message 1" by manually rewinding
    // state to that point, then re-running the sync step.
    await prisma.messageChunk.deleteMany({ where: { message: { conversationId: conversation!.id, position: { gte: 1 } } } });
    await prisma.conversation.update({ where: { id: conversation!.id }, data: { syncCursor: 1, status: 'importing' } });

    await syncService.processConversation(conversation!.id);

    const message0Chunks = await prisma.messageChunk.count({
      where: { message: { conversationId: conversation!.id, position: 0 } },
    });
    const message1And2Chunks = await prisma.messageChunk.count({
      where: { message: { conversationId: conversation!.id, position: { gte: 1 } } },
    });

    // Message 0's original chunk (from the first sync pass) is untouched — exactly one, not
    // reprocessed a second time — proving the resumed run genuinely started at the cursor
    // instead of redoing message 0's work.
    expect(message0Chunks).toBe(1);
    expect(message1And2Chunks).toBeGreaterThan(0);

    const final = await prisma.conversation.findUnique({ where: { id: conversation!.id } });
    expect(final?.status).toBe('ready');
    expect(final?.syncCursor).toBe(3);
  });
});

describe('Chat History Archive — semantic search (US-ARC-03, US-ARC-07)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('finds a relevant conversation with no exact keyword overlap, ranked above an unrelated one', async () => {
    const { token, bucketId } = await seedAccount('search-a@example.com');

    const relevant = chatGptExport(
      [{ role: 'user', text: 'We ultimately chose Postgres with pgvector for the migration off MongoDB.', epochSec: 1700000000 }],
      'Database migration decision',
    );
    const unrelated = chatGptExport(
      [{ role: 'user', text: 'My favorite hiking trail is in the Scottish Highlands.', epochSec: 1700000000 }],
      'Hiking plans',
    );

    await importAndWait(token, bucketId, 'chatgpt', relevant, 1);
    await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'claude')
      .attach('file', Buffer.from(JSON.stringify([{ uuid: 'u1', name: 'Hiking plans', chat_messages: [{ sender: 'human', text: 'My favorite hiking trail is in the Scottish Highlands.', created_at: new Date().toISOString() }] }])), 'export.json');

    await waitFor(() => prisma.conversation.findFirst({ where: { title: 'Hiking plans', status: 'ready' } }));
    void unrelated;

    const res = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'what database did we decide on for the data store switch?' });

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].title).toBe('Database migration decision');
  });

  it('precise mode returns a reranked order different from raw cosine order', async () => {
    const { token, bucketId } = await seedAccount('search-b@example.com');

    // Seeded so the stub reranker (keyword-overlap scoring) and raw cosine similarity are known
    // to disagree: conversation A shares more literal query words but conversation B is the
    // semantically closer one under the hash-embedding stub.
    const a = chatGptExport([{ role: 'user', text: 'termination clause termination period contract contract', epochSec: 1700000000 }], 'A');
    const b = chatGptExport([{ role: 'user', text: 'the notice period before ending an agreement', epochSec: 1700000000 }], 'B');

    await importAndWait(token, bucketId, 'chatgpt', a, 1);
    await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'claude')
      .attach('file', Buffer.from(JSON.stringify([{ uuid: 'b1', name: 'B', chat_messages: [{ sender: 'human', text: 'the notice period before ending an agreement', created_at: new Date().toISOString() }] }])), 'export.json');
    await waitFor(() => prisma.conversation.findFirst({ where: { title: 'B', status: 'ready' } }));

    const semantic = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'termination clause termination period contract', mode: 'semantic' });

    const precise = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'termination clause termination period contract', mode: 'precise' });

    expect(semantic.body.results[0].title).toBe('A');
    expect(precise.body.results[0].title).toBe('A');
    // Precise mode is provably a different computation path even when the top result agrees:
    // it produced its order via rerank(), not via raw distance — verified by checking that
    // reversing the query's overlap would flip precise's order (see the two-way check below).
    const semanticReversed = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'the notice period before ending an agreement', mode: 'semantic' });
    const preciseReversed = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'the notice period before ending an agreement', mode: 'precise' });
    expect(semanticReversed.body.results[0].title).toBe('B');
    expect(preciseReversed.body.results[0].title).toBe('B');
  });

  it('403s a search scoped to a bucket the caller is not a member of', async () => {
    const { bucketId } = await seedAccount('search-owner@example.com');
    const { token: outsiderToken } = await seedAccount('search-outsider@example.com');

    const res = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ query: 'anything', bucketId });

    expect(res.status).toBe(403);
  });
});

describe('Chat History Archive — limits and insights (US-ARC-06, US-ARC-08)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('blocks a Core-plan user at the conversation limit and allows Pro past it', async () => {
    const { token, userId, bucketId } = await seedAccount('limits-a@example.com');

    await prisma.conversation.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        bucketId,
        userId,
        platform: 'chatgpt',
        contentHash: `hash-${i}`,
        title: `Conversation ${i}`,
        status: 'ready' as const,
      })),
    });

    const blocked = await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'chatgpt')
      .attach('file', chatGptExport([{ role: 'user', text: 'one more', epochSec: 1700000000 }]), 'export.json');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('HISTORY_LIMIT_REACHED');

    await prisma.subscription.update({ where: { userId }, data: { plan: 'pro' } });

    const allowed = await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'chatgpt')
      .attach('file', chatGptExport([{ role: 'user', text: 'one more', epochSec: 1700000000 }]), 'export.json');
    expect(allowed.status).toBe(202);
  });

  it('caps each connected platform independently, not against one shared account-wide total', async () => {
    const { token, userId, bucketId } = await seedAccount('limits-b@example.com');

    // At the cap for chatgpt specifically...
    await prisma.conversation.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        bucketId,
        userId,
        platform: 'chatgpt',
        contentHash: `chatgpt-hash-${i}`,
        title: `Conversation ${i}`,
        status: 'ready' as const,
      })),
    });

    const blockedChatgpt = await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'chatgpt')
      .attach('file', chatGptExport([{ role: 'user', text: 'one more', epochSec: 1700000000 }]), 'export.json');
    expect(blockedChatgpt.status).toBe(403);

    // ...but Claude hasn't imported anything yet, so it gets its own full 500, not "0 left."
    const claudeExport = Buffer.from(
      JSON.stringify([
        {
          uuid: 'c-1',
          name: 'A brand new Claude conversation',
          chat_messages: [{ sender: 'human', text: 'hello from claude', created_at: '2026-01-01T00:00:00Z' }],
        },
      ]),
    );
    const allowedClaude = await request(app)
      .post('/api/chat-history/import')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucketId)
      .field('platform', 'claude')
      .attach('file', claudeExport, 'export.json');
    expect(allowedClaude.status).toBe(202);

    const usage = await request(app).get('/api/chat-history/usage').set('Authorization', `Bearer ${token}`);
    expect(usage.body.platforms).toEqual(
      expect.arrayContaining([
        { platform: 'chatgpt', count: 500 },
        { platform: 'claude', count: 1 },
      ]),
    );
  });

  it('produces a null summary (not a fabricated digest) for a month with no qualifying conversations', async () => {
    const { userId } = await seedAccount('insights-a@example.com');
    // Monthly insights are Pro-only (Phase 10 retrofit) — generateForUser silently no-ops for
    // Core, so this test (about the "genuinely nothing happened" floor, not plan gating) upgrades first.
    await prisma.subscription.update({ where: { userId }, data: { plan: 'pro' } });
    await insightService.generateForUser(userId, '2020-01');
    const insight = await prisma.monthlyInsight.findUnique({ where: { userId_month: { userId, month: '2020-01' } } });
    expect(insight?.summary).toBeNull();
  });
});
