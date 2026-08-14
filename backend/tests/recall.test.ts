import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { getLlmProvider, __setLlmProviderForTests } from '../src/shared/providers/llm.provider';
import {
  denseSearch,
  keywordSearch,
  hybridSearchOneVariant,
  loadChunkRows,
  expandContext,
  rerankRows,
  filterByRelevance,
  recall,
  recallAndSummarize,
  batchByTokenCeiling,
} from '../src/modules/chat-history/recall.service';
import { reciprocalRankFusion } from '../src/modules/chat-history/rank-fusion';
import { tokenCount } from '../src/shared/tokenizer';

const app = createApp();
afterAll(disconnect);

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
      message: { author: { role: m.role }, content: { content_type: 'text', parts: [m.text] }, create_time: m.epochSec },
      parent: parentId,
      children: [],
    };
    parentId = id;
  });
  return Buffer.from(JSON.stringify([{ title, current_node: ids[ids.length - 1], mapping }]));
}

async function importAndWait(token: string, bucketId: string, buffer: Buffer, title: string) {
  const res = await request(app)
    .post('/api/chat-history/import')
    .set('Authorization', `Bearer ${token}`)
    .field('bucketId', bucketId)
    .field('platform', 'chatgpt')
    .attach('file', buffer, 'export.json');
  expect(res.status).toBe(202);
  return waitFor(() => prisma.conversation.findFirst({ where: { bucketId, title, status: 'ready' } }));
}

describe('recall.service — Stage 2 hybrid search (US-ARC-07)', () => {
  beforeEach(resetDb);

  it('denseSearch ranks chunks by ascending cosine distance to the query embedding', async () => {
    const { token, bucketId } = await seedAccount('recall-dense@example.com');
    // Distinct epochSec per conversation: import.service.ts's contentHash dedup key for a
    // no-externalId platform like 'chatgpt' is `platform|firstMessageTimestamp|messageCount` —
    // identical timestamps here would collide and silently upsert the second import onto the
    // first's row instead of creating a second conversation.
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'I run 5k every morning before work.', epochSec: 1700000000 }], 'Running'), 'Running');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'My favorite recipe calls for saffron and slow-roasted lamb.', epochSec: 1700000100 }], 'Recipe'), 'Recipe');

    const embedding = await getLlmProvider().embed('what is my run routine');
    const ids = await denseSearch([bucketId], embedding);
    expect(ids.length).toBe(2);

    const rows = await loadChunkRows(ids);
    expect(rows[0].title).toBe('Running');
  });

  it('keywordSearch only returns chunks that actually match the query terms, ranked by ts_rank', async () => {
    const { token, bucketId } = await seedAccount('recall-keyword@example.com');
    await importAndWait(
      token,
      bucketId,
      chatGptExport([{ role: 'user', text: 'The quarterly roadmap review covers the roadmap timeline.', epochSec: 1700000000 }], 'Roadmap'),
      'Roadmap',
    );
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'Completely unrelated content about gardening.', epochSec: 1700000100 }], 'Gardening'), 'Gardening');

    const ids = await keywordSearch([bucketId], 'roadmap');
    const rows = await loadChunkRows(ids);

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Roadmap');
  });

  it('keywordSearch returns nothing for a bucket with no matching terms, distinct from a dense search over the same data', async () => {
    const { token, bucketId } = await seedAccount('recall-keyword-empty@example.com');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'Completely unrelated content about gardening.', epochSec: 1700000000 }], 'Gardening'), 'Gardening');

    const ids = await keywordSearch([bucketId], 'blockchain');
    expect(ids).toEqual([]);
  });

  it('hybridSearchOneVariant fuses the dense and keyword lists by rank, matching reciprocalRankFusion directly', async () => {
    const { token, bucketId } = await seedAccount('recall-hybrid@example.com');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'The quarterly roadmap review covers the roadmap timeline.', epochSec: 1700000000 }], 'Roadmap'), 'Roadmap');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'My favorite recipe calls for saffron and slow-roasted lamb.', epochSec: 1700000100 }], 'Recipe'), 'Recipe');

    const embedding = await getLlmProvider().embed('roadmap timeline');
    const [dense, keyword] = await Promise.all([denseSearch([bucketId], embedding), keywordSearch([bucketId], 'roadmap timeline')]);
    const expected = reciprocalRankFusion([dense, keyword]);

    const fused = await hybridSearchOneVariant([bucketId], 'roadmap timeline', embedding);
    expect(fused).toEqual(expected);
    expect(fused[0]).toBeTruthy();
  });

  it('returns nothing for buckets the caller has no access to', async () => {
    const embedding = await getLlmProvider().embed('anything');
    expect(await denseSearch([], embedding)).toEqual([]);
    expect(await keywordSearch([], 'anything')).toEqual([]);
    expect(await hybridSearchOneVariant([], 'anything', embedding)).toEqual([]);
  });
});

describe('recall.service — Stage 5 context expansion (MemoryPlugin_Clone_Spec.md §5.4 step 5)', () => {
  beforeEach(resetDb);

  it('pulls the neighboring message on each side of a hit, within the same conversation', async () => {
    const { token, bucketId } = await seedAccount('recall-context@example.com');
    await importAndWait(
      token,
      bucketId,
      chatGptExport(
        [
          { role: 'user', text: 'What database should we use?', epochSec: 1700000000 },
          { role: 'assistant', text: 'We ultimately chose Postgres with pgvector.', epochSec: 1700000001 },
          { role: 'user', text: 'Great, thanks for confirming.', epochSec: 1700000002 },
        ],
        'DB decision',
      ),
      'DB decision',
    );

    const ids = await keywordSearch([bucketId], 'postgres');
    const rows = await loadChunkRows(ids);
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(1);

    const [expanded] = await expandContext(rows);
    expect(expanded.before?.content).toBe('What database should we use?');
    expect(expanded.after?.content).toBe('Great, thanks for confirming.');
  });

  it('leaves a missing neighbor null instead of throwing (first or last message in a conversation)', async () => {
    const { token, bucketId } = await seedAccount('recall-context-edge@example.com');
    await importAndWait(
      token,
      bucketId,
      chatGptExport([{ role: 'user', text: 'A single lonely message about xenowidgets.', epochSec: 1700000000 }], 'Solo'),
      'Solo',
    );

    const ids = await keywordSearch([bucketId], 'xenowidgets');
    const rows = await loadChunkRows(ids);
    const [expanded] = await expandContext(rows);

    expect(expanded.before).toBeNull();
    expect(expanded.after).toBeNull();
  });

  it('returns an empty list for an empty input without querying anything', async () => {
    expect(await expandContext([])).toEqual([]);
  });
});

function fakeRow(id: string, content = ''): Parameters<typeof rerankRows>[1][number] {
  return { id, messageId: `msg-${id}`, content, position: 0, createdAt: new Date(), conversationId: `conv-${id}`, title: 'T', platform: 'chatgpt' };
}

describe('recall.service — Stage 3 rerank & Stage 4 relevance filter (wiring)', () => {
  afterAll(() => __setLlmProviderForTests(null));

  it('rerankRows reorders full row objects to match rerank()\'s returned id order, dropping any id it omits', async () => {
    const real = getLlmProvider();
    __setLlmProviderForTests({ ...real, rerank: async () => ['c', 'a'] }); // 'b' deliberately omitted

    const rows = [fakeRow('a', 'first'), fakeRow('b', 'second'), fakeRow('c', 'third')];
    const result = await rerankRows('query', rows);

    expect(result.map((r) => r.id)).toEqual(['c', 'a']);
    expect(result[0].content).toBe('third');
    expect(result[1].content).toBe('first');
  });

  it('rerankRows skips the provider call entirely for 0 or 1 rows', async () => {
    const real = getLlmProvider();
    const rerank = jest.fn().mockResolvedValue([]);
    __setLlmProviderForTests({ ...real, rerank });

    const single = [fakeRow('a')];
    expect(await rerankRows('query', single)).toBe(single);
    expect(await rerankRows('query', [])).toEqual([]);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('filterByRelevance keeps only the full row objects assessChunkRelevance judged relevant', async () => {
    const real = getLlmProvider();
    __setLlmProviderForTests({ ...real, assessChunkRelevance: async () => ['b'] });

    const rows = [fakeRow('a', 'irrelevant'), fakeRow('b', 'relevant')];
    const result = await filterByRelevance('query', rows);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('relevant');
  });

  it('filterByRelevance skips the provider call for an empty row list', async () => {
    const real = getLlmProvider();
    const assessChunkRelevance = jest.fn().mockResolvedValue([]);
    __setLlmProviderForTests({ ...real, assessChunkRelevance });

    expect(await filterByRelevance('query', [])).toEqual([]);
    expect(assessChunkRelevance).not.toHaveBeenCalled();
  });
});

describe('recall.service — recall() top-level composition (Stage 1 + full pipeline)', () => {
  beforeEach(resetDb);
  afterAll(() => __setLlmProviderForTests(null));

  it('with every optional stage off, returns the hybrid-fused, context-expanded pool unfiltered', async () => {
    const { token, bucketId } = await seedAccount('recall-compose-off@example.com');
    await importAndWait(
      token,
      bucketId,
      chatGptExport(
        [
          { role: 'user', text: 'What database should we use?', epochSec: 1700000000 },
          { role: 'assistant', text: 'We ultimately chose Postgres with pgvector.', epochSec: 1700000001 },
        ],
        'DB decision',
      ),
      'DB decision',
    );

    // No relevance filter runs in this mode (that's Stage 4's job, off here), and dense search has
    // no cutoff of its own — with only these two chunks in the whole account, both surface. The
    // keyword-matching one (shares "postgres") ranks first; context expansion still reaches its
    // neighboring message correctly.
    const result = await recall([bucketId], 'postgres');
    expect(result).toHaveLength(2);
    expect(result[0].content).toContain('Postgres');
    expect(result[0].before?.content).toBe('What database should we use?');
  });

  it('rerank + relevance-assessment toggles actually reorder and filter the pipeline output', async () => {
    const { token, bucketId } = await seedAccount('recall-compose-on@example.com');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'The quarterly roadmap review covers the roadmap timeline.', epochSec: 1700000000 }], 'Roadmap'), 'Roadmap');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'My favorite recipe calls for saffron and slow-roasted lamb.', epochSec: 1700000100 }], 'Recipe'), 'Recipe');

    const real = getLlmProvider();
    __setLlmProviderForTests({
      ...real,
      // Deliberately reverses whatever order hybrid search produced, so a passing test proves
      // rerank actually ran rather than just happening to agree with the fused order.
      rerank: async (_q, candidates) => candidates.map((c) => c.id).reverse(),
      // Deliberately drops the Recipe chunk regardless of its content, so a passing test proves
      // the relevance filter actually removed something.
      assessChunkRelevance: async (_q, candidates) => candidates.filter((c) => !c.content.includes('recipe')).map((c) => c.id),
    });

    const result = await recall([bucketId], 'roadmap timeline', { rerank: true, assessRelevance: true });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Roadmap');
  });

  it('Stage 1 query expansion fuses multiple variants and applies the extracted date filter', async () => {
    const { token, bucketId } = await seedAccount('recall-compose-expand@example.com');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'Old conversation about the roadmap from last year.', epochSec: 1600000000 }], 'Old'), 'Old');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'Recent conversation about the roadmap this week.', epochSec: 1700000000 }], 'Recent'), 'Recent');

    const cutoff = new Date(1650000000 * 1000); // between the two seeded messages' timestamps

    const real = getLlmProvider();
    __setLlmProviderForTests({
      ...real,
      expandQuery: async (query) => ({ variants: [query, 'a differently phrased variant'], dateFilter: { after: cutoff } }),
    });

    const result = await recall([bucketId], 'roadmap', { expandQuery: true });
    expect(result.every((r) => r.title === 'Recent')).toBe(true);
    expect(result.some((r) => r.title === 'Old')).toBe(false);
  });
});

describe('recall.service — batchByTokenCeiling (ADR-0005 map-reduce grouping)', () => {
  it('keeps rows in one batch while their combined tokens stay under the ceiling', () => {
    const rows = [fakeRow('a', 'hello'), fakeRow('b', 'world')];
    const ceiling = tokenCount('hello') + tokenCount('world') + 5;
    expect(batchByTokenCeiling(rows, ceiling)).toEqual([rows]);
  });

  it('starts a new batch once adding the next row would exceed the ceiling', () => {
    const a = fakeRow('a', 'hello');
    const b = fakeRow('b', 'world');
    const ceiling = tokenCount('hello'); // adding b's tokens would push the running total over
    expect(batchByTokenCeiling([a, b], ceiling)).toEqual([[a], [b]]);
  });

  it('never produces an empty batch, even when a single row alone exceeds the ceiling', () => {
    const huge = fakeRow('a', 'word '.repeat(50));
    expect(batchByTokenCeiling([huge], 1)).toEqual([[huge]]);
  });

  it('returns no batches for empty input', () => {
    expect(batchByTokenCeiling([], 1000)).toEqual([]);
  });
});

describe('recall.service — recallAndSummarize (Stage 6, ADR-0005)', () => {
  beforeEach(resetDb);
  // Reset before each test, not just after the whole block: a test earlier in this same block
  // that overrides the provider (e.g. with a bare jest.fn()) would otherwise leak into whichever
  // test runs next, since afterAll alone only fires once, at the very end.
  beforeEach(() => __setLlmProviderForTests(null));

  it('returns an empty summary and no citations without calling the LLM when nothing survives recall', async () => {
    const { bucketId } = await seedAccount('recall-summarize-empty@example.com');
    const real = getLlmProvider();
    const summarizeWithCitations = jest.fn();
    __setLlmProviderForTests({ ...real, summarizeWithCitations });

    const result = await recallAndSummarize([bucketId], 'anything', { tokenBudget: 600 });

    expect(result).toEqual({ summary: '', citations: [] });
    expect(summarizeWithCitations).not.toHaveBeenCalled();
  });

  it('citations map back to the conversation/message the summary actually drew from', async () => {
    const { token, bucketId } = await seedAccount('recall-summarize-basic@example.com');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: 'We ultimately chose Postgres with pgvector.', epochSec: 1700000000 }], 'DB decision'), 'DB decision');

    const result = await recallAndSummarize([bucketId], 'postgres', { tokenBudget: 600 });

    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ title: 'DB decision' });
    expect(result.citations[0].createdAt).toBeInstanceOf(Date);
  });

  it('folds across multiple batches via a map-reduce pass, carrying the running summary forward', async () => {
    const { token, bucketId } = await seedAccount('recall-summarize-fold@example.com');
    const bigMessage = (label: string) => `${label}: ` + 'roadmap timeline discussion. '.repeat(600);
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: bigMessage('Alpha'), epochSec: 1700000000 }], 'Alpha'), 'Alpha');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: bigMessage('Beta'), epochSec: 1700000100 }], 'Beta'), 'Beta');
    await importAndWait(token, bucketId, chatGptExport([{ role: 'user', text: bigMessage('Gamma'), epochSec: 1700000200 }], 'Gamma'), 'Gamma');

    const real = getLlmProvider();
    const priorSummaries: (string | undefined)[] = [];
    __setLlmProviderForTests({
      ...real,
      summarizeWithCitations: async (_q, chunks, opts) => {
        priorSummaries.push(opts.priorSummary);
        return { summary: `folded-through-call-${priorSummaries.length}`, citedIds: chunks.map((c) => c.id) };
      },
    });

    const result = await recallAndSummarize([bucketId], 'roadmap timeline', { tokenBudget: 600 });

    expect(priorSummaries.length).toBeGreaterThan(1);
    expect(priorSummaries[0]).toBeUndefined();
    for (let i = 1; i < priorSummaries.length; i++) {
      expect(priorSummaries[i]).toBe(`folded-through-call-${i}`);
    }
    expect(result.summary).toBe(`folded-through-call-${priorSummaries.length}`);
    expect(result.citations.length).toBeGreaterThan(0);
  }, 20000);
});
