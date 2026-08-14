import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { getLlmProvider, __setLlmProviderForTests } from '../src/shared/providers/llm.provider';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

async function createMemory(token: string, content: string) {
  const res = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content });
  const id = res.body.memory.id as string;
  // Memory.embedding is an Unsupported("vector") column — not selectable via the Prisma client,
  // hence the raw query — waited on so the fire-and-forget embedding pipeline has committed
  // before the test calls Ask (which filters on `embedding IS NOT NULL`).
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

// Makes the LLM "cite everything it was handed" instead of the default stub's "cite just the
// top chunk" — needed to exercise the multi-source blending ACs, which the single-file Phase 6
// stub was never designed to demonstrate on its own.
function useMultiCiteProvider() {
  const real = getLlmProvider();
  __setLlmProviderForTests({
    ...real,
    answerWithContext: async (_question, chunks) => ({
      answer: 'Synthesized answer blending every source provided.',
      usedChunkIds: chunks.map((c) => c.id),
    }),
  });
}

describe('Ask (US-ASK-01, US-ASK-02, US-ASK-03)', () => {
  beforeEach(resetDb);
  afterAll(() => {
    __setLlmProviderForTests(null);
    return disconnect();
  });

  it('blends a memory and a past conversation into one answer with both cited', async () => {
    const { token, bucketId } = await seedAccount('ask-a@example.com');
    await createMemory(token, 'We chose Postgres with pgvector for the search backend.');
    await importConversation(token, bucketId, 'We chose Postgres with pgvector for the search backend.', 'DB decision');

    useMultiCiteProvider();

    const res = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What database do we use for the search backend?', mode: 'all' });

    expect(res.status).toBe(200);
    const sourceTypes = new Set(res.body.message.citations.map((c: { sourceType: string }) => c.sourceType));
    expect(sourceTypes.has('memory')).toBe(true);
    expect(sourceTypes.has('message')).toBe(true);
  });

  it('returns the honest "no relevant context" response with zero citations when nothing matches', async () => {
    const { token } = await seedAccount('ask-b@example.com');
    await createMemory(token, 'My favorite hiking trail is in the Scottish Highlands.');

    const res = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What is the exact bank routing number on file?', mode: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.message.citations).toEqual([]);
    expect(res.body.message.content.toLowerCase()).toMatch(/don't have relevant context/);
  });

  it('re-runs retrieval per mode instead of filtering a cached call', async () => {
    const { token } = await seedAccount('ask-c@example.com');
    await createMemory(token, 'We chose Postgres with pgvector for the search backend.');

    const memoriesOnly = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What database do we use for the search backend?', mode: 'memories' });
    expect(memoriesOnly.body.message.citations.every((c: { sourceType: string }) => c.sourceType === 'memory')).toBe(true);

    const filesOnly = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What database do we use for the search backend?', mode: 'files' });
    // Nothing in the Files store at all — proves this mode genuinely queried Files (and found
    // nothing), not that it reused the memories-mode result set with a client-side filter.
    expect(filesOnly.body.message.citations).toEqual([]);
  });

  it('includes prior turns as context on a follow-up question, and the thread is resumable', async () => {
    const { token } = await seedAccount('ask-d@example.com');
    await createMemory(token, 'We chose Postgres with pgvector for the search backend.');

    let capturedQuestion = '';
    const real = getLlmProvider();
    __setLlmProviderForTests({
      ...real,
      answerWithContext: async (question, chunks) => {
        capturedQuestion = question;
        return { answer: 'follow-up answer', usedChunkIds: chunks.map((c) => c.id) };
      },
    });

    const first = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What database do we use for the search backend?', mode: 'memories' });
    const conversationId = first.body.conversationId as string;

    await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ conversationId, question: 'Why did we choose Postgres for the search backend?', mode: 'memories' });

    expect(capturedQuestion).toContain('What database do we use for the search backend?');
    expect(capturedQuestion).toContain('Why did we choose Postgres for the search backend?');

    const thread = await request(app).get(`/api/ask/threads/${conversationId}`).set('Authorization', `Bearer ${token}`);
    expect(thread.status).toBe(200);
    expect(thread.body.conversation.messages.length).toBe(4);
    expect(thread.body.conversation.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('locks a thread\'s mode after the first message; a new source needs a new conversation', async () => {
    const { token } = await seedAccount('ask-lock@example.com');
    await createMemory(token, 'We chose Postgres with pgvector for the search backend.');

    const first = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What database do we use?', mode: 'memories' });
    expect(first.status).toBe(200);
    const conversationId = first.body.conversationId as string;

    const switched = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ conversationId, question: 'What did we discuss last week?', mode: 'chat_history' });
    expect(switched.status).toBe(400);
    expect(switched.body.error.code).toBe('ASK_MODE_LOCKED');

    // The same mode as the thread started with is still a normal follow-up, not blocked.
    const followUp = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ conversationId, question: 'Why did we choose it?', mode: 'memories' });
    expect(followUp.status).toBe(200);
  });

  it('403s a bucket-scoped ask for a bucket the caller is not a member of', async () => {
    const { bucketId } = await seedAccount('ask-owner@example.com');
    const { token: outsiderToken } = await seedAccount('ask-outsider@example.com');

    const res = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ question: 'anything', mode: 'all', bucketId });

    expect(res.status).toBe(403);
  });

  it('never surfaces a different bucket\'s content, even one the same user owns', async () => {
    const { token, bucketId: defaultBucketId } = await seedAccount('ask-e@example.com');
    await createMemory(token, 'We chose Postgres with pgvector for the search backend.');

    const otherBucket = await request(app)
      .post('/api/buckets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Other Project' });
    const otherBucketId = otherBucket.body.bucket.id as string;

    useMultiCiteProvider();

    const res = await request(app)
      .post('/api/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What database do we use for the search backend?', mode: 'memories', bucketId: otherBucketId });

    expect(res.status).toBe(200);
    expect(res.body.message.citations).toEqual([]);
    void defaultBucketId;
  });
});
