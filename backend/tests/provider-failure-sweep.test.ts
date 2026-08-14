import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { getLlmProvider, __setLlmProviderForTests, ProviderError, callProvider } from '../src/shared/providers/llm.provider';
import { retrievalService } from '../src/modules/context/retrieval.service';
import { askService } from '../src/modules/ask/ask.service';
import { memoryService } from '../src/modules/memory/memory.service';
import { fileSearchService } from '../src/modules/file/file-search.service';
import { ragService } from '../src/modules/file/rag.service';
import { recall, rerankRows, filterByRelevance, recallAndSummarize, type RecallChunkRow } from '../src/modules/chat-history/recall.service';
import { buildTestPdf } from './pdf-fixture';

// Phase 18.2 (§7.4, plan delivery step 2): "audit every call site catching a provider call today
// ... to handle the distinction explicitly — this is a sweep across existing code." Each test here
// simulates a real provider outage (a thrown ProviderError) at one of the call sites the sweep
// touched, and asserts the caller surfaces AppError.serviceUnavailable's shape (503,
// PROVIDER_UNAVAILABLE) — never a misleadingly-empty, normal-looking 200 result.

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
      .$queryRaw<{ embedded: boolean }[]>`SELECT (embedding IS NOT NULL) AS embedded FROM "Memory" WHERE id = ${id}`
      .then((rows) => (rows[0]?.embedded ? rows[0] : undefined)),
  );
  return id;
}

async function uploadReadyFile(token: string, bucketId: string, pageText: string) {
  const pdf = buildTestPdf([pageText]);
  const upload = await request(app)
    .post('/api/files')
    .set('Authorization', `Bearer ${token}`)
    .field('bucketId', bucketId)
    .attach('file', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });
  return waitFor(() =>
    prisma.file.findUnique({ where: { id: upload.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
  );
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

function fakeRow(id: string, content: string): RecallChunkRow {
  return {
    id,
    messageId: `m-${id}`,
    content,
    position: 0,
    createdAt: new Date(),
    conversationId: `c-${id}`,
    title: 'title',
    platform: 'chatgpt',
  };
}

const PROVIDER_DOWN = { statusCode: 503, code: 'PROVIDER_UNAVAILABLE' };

function throwingProvider(overrides: Record<string, () => Promise<never>>) {
  const real = getLlmProvider();
  const failing = Object.fromEntries(
    Object.entries(overrides).map(([key, fn]) => [key, async (..._args: unknown[]) => fn()]),
  );
  __setLlmProviderForTests({ ...real, ...failing } as ReturnType<typeof getLlmProvider>);
}

describe('callProvider (§7.4 sweep helper)', () => {
  it('translates a caught ProviderError into AppError.serviceUnavailable', async () => {
    await expect(
      callProvider(async () => {
        throw new ProviderError('embed down');
      }, 'a clear, user-facing message'),
    ).rejects.toMatchObject({ ...PROVIDER_DOWN, message: 'a clear, user-facing message' });
  });

  it('rethrows a non-ProviderError unchanged rather than masking an unrelated bug', async () => {
    const bug = new Error('unrelated bug');
    await expect(
      callProvider(async () => {
        throw bug;
      }, 'unused'),
    ).rejects.toBe(bug);
  });

  it('resolves normally when the wrapped call succeeds', async () => {
    await expect(callProvider(async () => 42, 'unused')).resolves.toBe(42);
  });
});

describe('Phase 18.2 sweep — memory/context/file/ask services surface a 503, not an empty result', () => {
  beforeEach(resetDb);
  afterEach(() => __setLlmProviderForTests(null));

  it('retrievalService.buildContext rejects with a 503 when embed fails', async () => {
    const { userId } = await seedAccount('sweep-context@example.com');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    await expect(retrievalService.buildContext(userId, { snippet: 'anything' })).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('memoryService.search rejects with a 503 when embed fails', async () => {
    const { userId } = await seedAccount('sweep-memory-search@example.com');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    await expect(memoryService.search(userId, { query: 'anything', limit: 10 })).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('fileSearchService.search rejects with a 503 when embed fails', async () => {
    const { userId } = await seedAccount('sweep-file-search@example.com');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    await expect(fileSearchService.search(userId, { query: 'anything' })).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('ragService.answer rejects with a 503 when embed fails, before ever reaching answerWithContext', async () => {
    const { token, userId, bucketId } = await seedAccount('sweep-rag-embed@example.com');
    const file = await uploadReadyFile(token, bucketId, 'Some page text.');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    await expect(ragService.answer(userId, file!.id, 'What does it say?')).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('ragService.answer rejects with a 503 when answerWithContext fails after a real match is found', async () => {
    const { token, userId, bucketId } = await seedAccount('sweep-rag-answer@example.com');
    const file = await uploadReadyFile(token, bucketId, 'Termination after ninety days notice.');
    throwingProvider({ answerWithContext: async () => { throw new ProviderError('answer down'); } });

    await expect(
      ragService.answer(userId, file!.id, "What is the file's termination notice period?"),
    ).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('askService.ask rejects with a 503 when embed fails', async () => {
    const { userId } = await seedAccount('sweep-ask-embed@example.com');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    await expect(askService.ask(userId, { question: 'anything', mode: 'memories' })).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('askService.ask rejects with a 503 when answerWithContext fails after a real candidate is found', async () => {
    const { token, userId } = await seedAccount('sweep-ask-answer@example.com');
    const question = 'What did we decide about the database?';
    // Content identical to the question guarantees a match under the deterministic stub hash
    // embedding (same text hashes to the same vector, i.e. zero distance) regardless of threshold.
    await createMemory(token, question);
    throwingProvider({ answerWithContext: async () => { throw new ProviderError('answer down'); } });

    await expect(askService.ask(userId, { question, mode: 'memories' })).rejects.toMatchObject(PROVIDER_DOWN);
  });
});

describe('Phase 18.2 sweep — recall.service (Phase 17 stages) surface a 503 on provider failure', () => {
  afterEach(() => __setLlmProviderForTests(null));

  it('recall() rejects with a 503 when the per-variant embed call fails', async () => {
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    await expect(recall(['bucket-x'], 'anything')).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('recall() rejects with a 503 when Stage 1 query expansion fails', async () => {
    throwingProvider({ expandQuery: async () => { throw new ProviderError('expand down'); } });

    await expect(recall(['bucket-x'], 'anything', { expandQuery: true })).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('rerankRows (Stage 3) rejects with a 503 when rerank fails', async () => {
    throwingProvider({ rerank: async () => { throw new ProviderError('rerank down'); } });

    const rows = [fakeRow('a', 'hello'), fakeRow('b', 'world')];
    await expect(rerankRows('query', rows)).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('filterByRelevance (Stage 4) rejects with a 503 when assessChunkRelevance fails', async () => {
    throwingProvider({ assessChunkRelevance: async () => { throw new ProviderError('relevance down'); } });

    const rows = [fakeRow('a', 'hello')];
    await expect(filterByRelevance('query', rows)).rejects.toMatchObject(PROVIDER_DOWN);
  });

  it('recallAndSummarize (Stage 6) rejects with a 503 when summarizeWithCitations fails', async () => {
    await resetDb();
    const { token, bucketId } = await seedAccount('sweep-recall-summarize@example.com');
    await importConversation(token, bucketId, 'We ultimately chose Postgres with pgvector.', 'DB decision');
    throwingProvider({ summarizeWithCitations: async () => { throw new ProviderError('summarize down'); } });

    await expect(recallAndSummarize([bucketId], 'postgres', { tokenBudget: 600 })).rejects.toMatchObject(PROVIDER_DOWN);
  });
});

describe('Phase 18.2 sweep — end-to-end HTTP: a provider outage is a real 503, not a silent 200', () => {
  beforeEach(resetDb);
  afterEach(() => __setLlmProviderForTests(null));

  it('POST /api/context/preview responds 503 when embed fails', async () => {
    const { token } = await seedAccount('sweep-http-context@example.com');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    const res = await request(app).post('/api/context/preview').set('Authorization', `Bearer ${token}`).send({ snippet: 'anything' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('POST /api/chat-history/search responds 503 when embed fails deep inside the recall pipeline', async () => {
    const { token } = await seedAccount('sweep-http-chatsearch@example.com');
    throwingProvider({ embed: async () => { throw new ProviderError('embed down'); } });

    const res = await request(app)
      .post('/api/chat-history/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'anything', mode: 'semantic' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});
