import { getLlmProvider } from '../src/shared/providers/llm.provider';

// No API key is configured anywhere in the test environment (see tests/env.setup.ts), so
// getLlmProvider() always resolves to the deterministic stub here — these tests exercise exactly
// what the rest of the suite runs against, not the real Anthropic/OpenRouter call paths (which
// this codebase has never unit-tested directly for any of its existing methods either; see
// rerank/answerWithContext/extractEntities, all only exercised indirectly via the services that
// call them, with no API key configured).
describe('LlmProvider — Phase 17 recall-pipeline methods (stub)', () => {
  const provider = getLlmProvider();

  describe('expandQuery', () => {
    it('always includes the verbatim original query among the variants', async () => {
      const result = await provider.expandQuery('what did I decide about the database', new Date());
      expect(result.variants).toContain('what did I decide about the database');
    });
  });

  describe('assessChunkRelevance', () => {
    it('keeps a candidate sharing a query word and drops one that shares none', async () => {
      const relevant = await provider.assessChunkRelevance('roadmap timeline', [
        { id: 'a', content: 'The quarterly roadmap review covers the timeline.' },
        { id: 'b', content: 'Completely unrelated content about gardening.' },
      ]);
      expect(relevant).toContain('a');
      expect(relevant).not.toContain('b');
    });

    it('returns an empty list for an empty candidate set without erroring', async () => {
      expect(await provider.assessChunkRelevance('anything', [])).toEqual([]);
    });
  });

  describe('summarizeWithCitations', () => {
    it('returns an empty summary and no citations for an empty chunk set', async () => {
      const result = await provider.summarizeWithCitations('anything', [], { tokenBudget: 600 });
      expect(result).toEqual({ summary: '', citedIds: [] });
    });

    it('only cites chunks it actually folded into the summary within the token budget', async () => {
      const chunks = [
        { id: 'a', content: 'x'.repeat(100) },
        { id: 'b', content: 'y'.repeat(100) },
        { id: 'c', content: 'z'.repeat(100) },
      ];
      // A tiny budget (a handful of tokens) still guarantees at least the first chunk gets cited —
      // the stub's own "never cite nothing if there's something to cite" floor — while proving the
      // budget is actually enforced: not every chunk makes it in.
      const result = await provider.summarizeWithCitations('anything', chunks, { tokenBudget: 10 });
      expect(result.citedIds.length).toBeGreaterThan(0);
      expect(result.citedIds.length).toBeLessThan(chunks.length);
    });

    it('folds a prior running summary into the result (map-reduce continuation)', async () => {
      const result = await provider.summarizeWithCitations(
        'anything',
        [{ id: 'a', content: 'new information' }],
        { tokenBudget: 600, priorSummary: 'earlier established fact' },
      );
      expect(result.summary).toContain('earlier established fact');
    });
  });

  describe('proposeCuratorAction (Phase 19, ADR-0004)', () => {
    function item(id: string, content: string, daysAgo: number) {
      return { id, content, createdAt: new Date(Date.now() - daysAgo * 86_400_000) };
    }

    it('proposes nothing for an empty cluster', async () => {
      const result = await provider.proposeCuratorAction(item('a', 'anything', 0), []);
      expect(result).toEqual({ action: 'none' });
    });

    it('proposes "remove" for a near-identical pair, targeting the newer memory', async () => {
      const older = item('older', 'I deploy my side projects to Railway now.', 2);
      const newer = item('newer', 'I deploy my side projects to Railway now', 0);
      const result = await provider.proposeCuratorAction(newer, [older]);
      expect(result).toEqual({ action: 'remove', memoryId: 'newer' });
    });

    it('proposes "update" for a genuine contradiction, targeting the older memory with the newer content', async () => {
      const older = item('older', 'I live in Berlin and work as a software engineer.', 2);
      const newer = item('newer', 'I now live in Lisbon and work as a software engineer.', 0);
      const result = await provider.proposeCuratorAction(older, [newer]);
      expect(result).toMatchObject({ action: 'update', memoryId: 'older', content: newer.content });
    });

    it('proposes "combine" for related-but-not-contradicting memories, preserving both contents', async () => {
      const a = item('a', 'My favorite programming language is Python.', 2);
      const b = item('b', 'My favorite programming language is also Rust.', 0);
      const result = await provider.proposeCuratorAction(a, [b]);
      expect(result.action).toBe('combine');
      if (result.action === 'combine') {
        expect(result.memoryIds.sort()).toEqual(['a', 'b']);
        expect(result.content).toContain('Python');
        expect(result.content).toContain('Rust');
      }
    });

    it('proposes nothing for genuinely unrelated memories', async () => {
      const a = item('a', 'I love hiking in the mountains every summer.', 0);
      const b = item('b', 'Quarterly revenue grew twelve percent year over year.', 0);
      const result = await provider.proposeCuratorAction(a, [b]);
      expect(result).toEqual({ action: 'none' });
    });
  });
});
