import {
  ProviderError,
  AnthropicLlmProvider,
  OpenRouterLlmProvider,
  OpenAiEmbeddingProvider,
} from '../src/shared/providers/llm.provider';

function fakeFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('LlmProvider — Phase 18 fail-open, never fail-silent (§7.4)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('AnthropicLlmProvider', () => {
    const provider = new AnthropicLlmProvider('fake-key');

    it('embed always uses the deterministic hash embedding (no first-party Anthropic embeddings API) — not a failure path', async () => {
      // No fetch involved at all; documents the existing, deliberate design rather than testing
      // a bug — embed() here was never a "falls back to stub on failure" case to begin with.
      const embedding = await provider.embed('hello');
      expect(embedding).toHaveLength(1536);
    });

    it('rerank throws ProviderError — not a stub-shaped fallback — when the completion call itself fails', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.rerank('query', [{ id: 'a', content: 'x' }])).rejects.toThrow(ProviderError);
    });

    it('rerank still degrades gracefully (not a throw) when the call succeeds but the reply is malformed', async () => {
      global.fetch = fakeFetch(200, { content: [{ text: 'not a valid comma list' }] }) as unknown as typeof fetch;
      // Malformed-but-present content is a data-quality issue, not an infra failure — the
      // pre-existing stub-fallback behavior for this case is deliberately preserved.
      const order = await provider.rerank('query', [{ id: 'a', content: 'x' }]);
      expect(Array.isArray(order)).toBe(true);
    });

    it('extractMemoryCandidates throws ProviderError on a failed call and returns [] (not a stub) for a legitimate empty reply', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.extractMemoryCandidates('snippet')).rejects.toThrow(ProviderError);

      global.fetch = fakeFetch(200, { content: [{ text: '' }] }) as unknown as typeof fetch;
      await expect(provider.extractMemoryCandidates('snippet')).resolves.toEqual([]);
    });

    it('suggestCategoryLabel throws ProviderError on a failed call', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.suggestCategoryLabel('content')).rejects.toThrow(ProviderError);
    });

    it('summarize throws ProviderError on a failed call', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.summarize('text')).rejects.toThrow(ProviderError);
    });

    it('answerWithContext throws ProviderError on a failed call', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.answerWithContext('question', [{ id: 'a', content: 'x' }])).rejects.toThrow(ProviderError);
    });

    it('extractEntities throws ProviderError on a failed call', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.extractEntities('text')).rejects.toThrow(ProviderError);
    });

    it('the three Phase 17 recall methods already throw ProviderError on a failed call (regression guard)', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.expandQuery('query', new Date())).rejects.toThrow(ProviderError);
      await expect(provider.assessChunkRelevance('query', [{ id: 'a', content: 'x' }])).rejects.toThrow(ProviderError);
      await expect(provider.summarizeWithCitations('query', [{ id: 'a', content: 'x' }], { tokenBudget: 100 })).rejects.toThrow(ProviderError);
    });
  });

  describe('OpenRouterLlmProvider', () => {
    const provider = new OpenRouterLlmProvider('fake-key');

    it('embed throws ProviderError on a failed call instead of silently substituting the hash embedding', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.embed('hello')).rejects.toThrow(ProviderError);
    });

    it('rerank throws ProviderError on a failed completion call', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.rerank('query', [{ id: 'a', content: 'x' }])).rejects.toThrow(ProviderError);
    });

    it('extractMemoryCandidates throws ProviderError on a failed call', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      await expect(provider.extractMemoryCandidates('snippet')).rejects.toThrow(ProviderError);
    });
  });

  describe('OpenAiEmbeddingProvider', () => {
    it('embed throws ProviderError on a failed call instead of silently substituting the hash embedding', async () => {
      global.fetch = fakeFetch(500, {}) as unknown as typeof fetch;
      const provider = new OpenAiEmbeddingProvider('fake-key');
      await expect(provider.embed('hello')).rejects.toThrow(ProviderError);
    });
  });
});
