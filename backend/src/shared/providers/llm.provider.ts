import crypto from 'crypto';
import { logger } from '../logger';

export interface CaptureCandidate {
  content: string;
}

export interface LlmProvider {
  /** Given a raw conversation snippet, propose zero or more atomic facts worth remembering. */
  extractMemoryCandidates(snippet: string): Promise<CaptureCandidate[]>;
  /** Produce a fixed-length embedding for similarity search (dimension must match the schema's vector(1536)). */
  embed(text: string): Promise<number[]>;
  /** Propose a short human-readable label for a new category, seeded from one representative memory. */
  suggestCategoryLabel(content: string): Promise<string>;
  /** Produce a short summary of a long text (Phase 5 US-ARC-05: conversation summaries). */
  summarize(text: string): Promise<string>;
  /** Re-order candidates by relevance to the query, most relevant first (Phase 5 US-ARC-07: high-accuracy recall). Returns candidate ids in the new order. */
  rerank(query: string, candidates: { id: string; content: string }[]): Promise<string[]>;
  /** Ground an answer in the given chunks, citing which ones it actually used (Phase 6 US-FIL-03). */
  answerWithContext(
    question: string,
    chunks: { id: string; content: string }[],
  ): Promise<{ answer: string; usedChunkIds: string[] }>;
  /** Extract named entities and the relations between them mentioned together in one text (Phase 9 US-ADV-02). */
  extractEntities(text: string): Promise<EntityExtractionResult>;
}

export interface EntityExtractionResult {
  entities: { name: string; type: string }[];
  relations: { from: string; to: string; label: string }[];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in',
  'on', 'at', 'for', 'with', 'my', 'me', 'i', 'you', 'your', 'it', 'this', 'that', 'as', 'by',
  'from', 'has', 'have', 'had', 'not', 'so', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
]);

// Stub labeling: pick the most frequent non-stopword in the memory, title-case it. Good enough to
// exercise "a label gets created and reused" without a real LLM configured — see
// docs/Phase4_Implementation_Plan.md §5.2.
function stubSuggestCategoryLabel(content: string): string {
  const words = content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) {
    if (STOPWORDS.has(word) || word.length < 3) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['general'];
  return top.charAt(0).toUpperCase() + top.slice(1);
}

// Deterministic stub summarizer: the first two sentences, same "good enough to exercise the
// contract, not shippable as real summarization" bar as stubSuggestCategoryLabel. Real
// implementations (Anthropic) replace this with an actual LLM call behind the same signature.
function stubSummarize(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, 2).join(' ') || text.slice(0, 200);
}

// Deterministic stub rerank: scores each candidate by keyword-overlap word count with the query
// (a real cross-encoder call would score semantic relevance instead) — enough to prove "the
// rerank step changes the order" is wired correctly end to end without a network call.
function stubRerank(query: string, candidates: { id: string; content: string }[]): string[] {
  const queryWords = new Set((query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3));
  const scored = candidates.map((c) => {
    const words = c.content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const score = words.reduce((sum, w) => sum + (queryWords.has(w) ? 1 : 0), 0);
    return { id: c.id, score };
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.id);
}

// Deterministic stub answerer: no real LLM configured, so the "answer" is the single most
// relevant chunk verbatim, clearly labeled as such rather than pretending to synthesize one —
// see docs/Phase6_Implementation_Plan.md §4.
function stubAnswerWithContext(
  chunks: { id: string; content: string }[],
): { answer: string; usedChunkIds: string[] } {
  const top = chunks[0];
  if (!top) return { answer: '', usedChunkIds: [] };
  return {
    answer: `No LLM configured — showing the most relevant passage: "${top.content}"`,
    usedChunkIds: [top.id],
  };
}

// Stub extraction: a real implementation calls an LLM for genuine NLP entity/relation extraction.
// This deterministic version treats capitalized word runs ("Client A", "Project X") as candidate
// proper-noun entities and every pair mentioned in the same text as related — enough to exercise
// "a node gets created per entity, an edge per co-mention, every edge attributed to its source"
// end to end without a network call. Not shippable as real NLP — same bar stubSuggestCategoryLabel
// sets (see docs/Phase9_Implementation_Plan.md §4).
const CAPITALIZED_RUN = /\b[A-Z][a-zA-Z0-9]*(?:\s[A-Z][a-zA-Z0-9]*)*\b/g;

function stubExtractEntities(text: string): EntityExtractionResult {
  const matches = text.match(CAPITALIZED_RUN) ?? [];
  const seen = new Map<string, string>();
  for (const match of matches) {
    const normalized = match.toLowerCase().trim();
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.set(normalized, match.trim());
  }
  const entities = [...seen.values()].map((name) => ({ name, type: 'topic' }));
  const relations: { from: string; to: string; label: string }[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      relations.push({ from: entities[i].name, to: entities[j].name, label: 'mentioned with' });
    }
  }
  return { entities, relations };
}

const EMBEDDING_DIM = 1536;

/**
 * Deterministic, dependency-free feature-hashing embedding: tokenizes text into words and hashes
 * each into one of EMBEDDING_DIM buckets, then L2-normalizes. Unlike a real model embedding, this
 * has no semantic understanding — but two strings sharing most of their vocabulary land close
 * together in cosine distance, and unrelated strings land far apart, which is exactly the property
 * duplicate/stale detection needs to be testable without a network call or an API key.
 *
 * Used whenever no real embedding provider is configured (dev, tests, CI) — see getLlmProvider().
 */
function hashEmbed(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    const hash = crypto.createHash('sha1').update(word).digest();
    const bucket = hash.readUInt32BE(0) % EMBEDDING_DIM;
    const sign = hash[4] % 2 === 0 ? 1 : -1;
    vector[bucket] += sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}

// Stub extraction: a real implementation calls an LLM to pull out atomic, self-contained facts.
// This deterministic version treats each sentence as one candidate so the capture pipeline
// (draft -> confirm -> save) is fully exercisable in tests without an API key.
function stubExtract(snippet: string): CaptureCandidate[] {
  return snippet
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, 5)
    .map((content) => ({ content }));
}

export const stubLlmProvider: LlmProvider = {
  async extractMemoryCandidates(snippet: string) {
    return stubExtract(snippet);
  },
  async embed(text: string) {
    return hashEmbed(text);
  },
  async suggestCategoryLabel(content: string) {
    return stubSuggestCategoryLabel(content);
  },
  async summarize(text: string) {
    return stubSummarize(text);
  },
  async rerank(query, candidates) {
    return stubRerank(query, candidates);
  },
  async answerWithContext(_question, chunks) {
    return stubAnswerWithContext(chunks);
  },
  async extractEntities(text: string) {
    return stubExtractEntities(text);
  },
};

/**
 * US-SEC-02 ("no training on user data") as a checked configuration rather than a claim on a
 * privacy page. Every outbound call from this file sets this header.
 *
 * What this does and doesn't guarantee, stated honestly:
 *  - Anthropic's commercial terms already state that API inputs/outputs are not used to train
 *    their models. This header additionally opts out of the abuse-detection retention window,
 *    so prompts are not stored server-side after the response is returned.
 *  - It binds Anthropic only. OpenAI (embeddings, below) is governed by its own API terms, which
 *    likewise exclude API data from training by default.
 *  - Product_Requirements.md §10 flags that the customer-facing version of this claim still needs
 *    a legal/compliance review of the provider's actual current terms before it goes on a pricing
 *    page. That review is NOT satisfied by this constant — this is the engineering half only.
 */
const NO_TRAINING_HEADERS = { 'anthropic-beta': 'zero-retention-2024-01-01' } as const;

// Real providers plug in here behind the same interface (codebase-design: swappable, small
// surface). Anthropic has no first-party embeddings endpoint, so extraction and embedding are
// deliberately independent — either can be "real" while the other stays stubbed.
class AnthropicLlmProvider implements LlmProvider {
  constructor(private apiKey: string) {}

  async extractMemoryCandidates(snippet: string): Promise<CaptureCandidate[]> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        ...NO_TRAINING_HEADERS,
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 512,
        system:
          'Extract atomic, self-contained facts worth remembering long-term from the conversation snippet. ' +
          'Reply with one fact per line, no numbering, no commentary. If nothing is worth remembering, reply with an empty response.',
        messages: [{ role: 'user', content: snippet }],
      }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, 'Anthropic extraction call failed; falling back to stub');
      return stubExtract(snippet);
    }

    const body = (await res.json()) as { content?: { text?: string }[] };
    const text = body.content?.[0]?.text ?? '';
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((content) => ({ content }));
  }

  async embed(text: string): Promise<number[]> {
    // No first-party Anthropic embeddings API — fall back to the deterministic hash embedding
    // unless a separate embedding provider (e.g. OpenAI) is configured.
    return hashEmbed(text);
  }

  async suggestCategoryLabel(content: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        ...NO_TRAINING_HEADERS,
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 16,
        system: 'Reply with a short (1-3 word) title-case category label for the memory below. No punctuation, no commentary.',
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, 'Anthropic category-label call failed; falling back to stub');
      return stubSuggestCategoryLabel(content);
    }

    const body = (await res.json()) as { content?: { text?: string }[] };
    const label = body.content?.[0]?.text?.trim();
    return label || stubSuggestCategoryLabel(content);
  }

  async summarize(text: string): Promise<string> {
    const res = await this.complete(
      'Summarize the following in 2-3 sentences, no preamble.',
      text,
      256,
    );
    return res ?? stubSummarize(text);
  }

  async rerank(query: string, candidates: { id: string; content: string }[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const listing = candidates.map((c, i) => `[${i}] ${c.content}`).join('\n');
    const res = await this.complete(
      'Given the query and a numbered list of candidate passages, reply with ONLY the indices ' +
        'in order from most to least relevant, comma-separated (e.g. "2,0,1"). No commentary.',
      `Query: ${query}\n\nCandidates:\n${listing}`,
      64,
    );
    const order = res
      ?.split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length);
    if (!order || order.length !== candidates.length) return stubRerank(query, candidates);
    return order.map((i) => candidates[i].id);
  }

  async answerWithContext(
    question: string,
    chunks: { id: string; content: string }[],
  ): Promise<{ answer: string; usedChunkIds: string[] }> {
    if (chunks.length === 0) return { answer: '', usedChunkIds: [] };
    const listing = chunks.map((c, i) => `[${i}] ${c.content}`).join('\n\n');
    const res = await this.complete(
      'Answer the question using ONLY the numbered passages below. If they do not contain the ' +
        'answer, say so plainly. End your reply with a line "USED: <comma-separated indices you drew from>".',
      `Question: ${question}\n\nPassages:\n${listing}`,
      512,
    );
    if (!res) return stubAnswerWithContext(chunks);
    const usedMatch = res.match(/USED:\s*([\d,\s]+)/i);
    const answer = res.replace(/USED:\s*[\d,\s]+/i, '').trim();
    const usedChunkIds = usedMatch
      ? usedMatch[1]
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((i) => Number.isInteger(i) && i >= 0 && i < chunks.length)
          .map((i) => chunks[i].id)
      : [chunks[0].id];
    return { answer, usedChunkIds };
  }

  async extractEntities(text: string): Promise<EntityExtractionResult> {
    const res = await this.complete(
      'Extract named entities (people, projects, clients, technologies, topics) mentioned in the ' +
        'text and the relations between entities mentioned together. Reply with ONLY strict JSON ' +
        'of the shape {"entities":[{"name":"...","type":"..."}],"relations":[{"from":"...","to":"...","label":"..."}]}. ' +
        'No commentary, no markdown fences.',
      text,
      512,
    );
    if (!res) return stubExtractEntities(text);
    try {
      const parsed = JSON.parse(res) as EntityExtractionResult;
      if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) {
        return stubExtractEntities(text);
      }
      return parsed;
    } catch {
      logger.error('Anthropic entity-extraction reply was not valid JSON; falling back to stub');
      return stubExtractEntities(text);
    }
  }

  private async complete(system: string, userText: string, maxTokens: number): Promise<string | null> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        ...NO_TRAINING_HEADERS,
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'Anthropic completion call failed; falling back to stub');
      return null;
    }
    const body = (await res.json()) as { content?: { text?: string }[] };
    return body.content?.[0]?.text?.trim() ?? null;
  }
}

class OpenAiEmbeddingProvider {
  constructor(private apiKey: string) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, 'OpenAI embedding call failed; falling back to stub');
      return hashEmbed(text);
    }

    const body = (await res.json()) as { data?: { embedding?: number[] }[] };
    return body.data?.[0]?.embedding ?? hashEmbed(text);
  }
}

// OpenRouter exposes an OpenAI-compatible /chat/completions endpoint that can route to many
// underlying models (Anthropic, OpenAI, Meta, etc.) behind one key — same LlmProvider surface as
// AnthropicLlmProvider, so it's a drop-in alternative extraction backend. It also proxies
// OpenAI-compatible embedding models, so it can independently serve embed() too.
class OpenRouterLlmProvider implements LlmProvider {
  constructor(
    private apiKey: string,
    private model = 'anthropic/claude-3.5-haiku',
  ) {}

  async extractMemoryCandidates(snippet: string): Promise<CaptureCandidate[]> {
    const res = await this.complete(
      'Extract atomic, self-contained facts worth remembering long-term from the conversation snippet. ' +
        'Reply with one fact per line, no numbering, no commentary. If nothing is worth remembering, reply with an empty response.',
      snippet,
      512,
    );
    if (res === null) return stubExtract(snippet);
    return res
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((content) => ({ content }));
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, 'OpenRouter embedding call failed; falling back to stub');
      return hashEmbed(text);
    }

    const body = (await res.json()) as { data?: { embedding?: number[] }[] };
    return body.data?.[0]?.embedding ?? hashEmbed(text);
  }

  async suggestCategoryLabel(content: string): Promise<string> {
    const res = await this.complete(
      'Reply with a short (1-3 word) title-case category label for the memory below. No punctuation, no commentary.',
      content,
      16,
    );
    return res?.trim() || stubSuggestCategoryLabel(content);
  }

  async summarize(text: string): Promise<string> {
    const res = await this.complete('Summarize the following in 2-3 sentences, no preamble.', text, 256);
    return res ?? stubSummarize(text);
  }

  async rerank(query: string, candidates: { id: string; content: string }[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const listing = candidates.map((c, i) => `[${i}] ${c.content}`).join('\n');
    const res = await this.complete(
      'Given the query and a numbered list of candidate passages, reply with ONLY the indices ' +
        'in order from most to least relevant, comma-separated (e.g. "2,0,1"). No commentary.',
      `Query: ${query}\n\nCandidates:\n${listing}`,
      64,
    );
    const order = res
      ?.split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length);
    if (!order || order.length !== candidates.length) return stubRerank(query, candidates);
    return order.map((i) => candidates[i].id);
  }

  async answerWithContext(
    question: string,
    chunks: { id: string; content: string }[],
  ): Promise<{ answer: string; usedChunkIds: string[] }> {
    if (chunks.length === 0) return { answer: '', usedChunkIds: [] };
    const listing = chunks.map((c, i) => `[${i}] ${c.content}`).join('\n\n');
    const res = await this.complete(
      'Answer the question using ONLY the numbered passages below. If they do not contain the ' +
        'answer, say so plainly. End your reply with a line "USED: <comma-separated indices you drew from>".',
      `Question: ${question}\n\nPassages:\n${listing}`,
      512,
    );
    if (!res) return stubAnswerWithContext(chunks);
    const usedMatch = res.match(/USED:\s*([\d,\s]+)/i);
    const answer = res.replace(/USED:\s*[\d,\s]+/i, '').trim();
    const usedChunkIds = usedMatch
      ? usedMatch[1]
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((i) => Number.isInteger(i) && i >= 0 && i < chunks.length)
          .map((i) => chunks[i].id)
      : [chunks[0].id];
    return { answer, usedChunkIds };
  }

  async extractEntities(text: string): Promise<EntityExtractionResult> {
    const res = await this.complete(
      'Extract named entities (people, projects, clients, technologies, topics) mentioned in the ' +
        'text and the relations between entities mentioned together. Reply with ONLY strict JSON ' +
        'of the shape {"entities":[{"name":"...","type":"..."}],"relations":[{"from":"...","to":"...","label":"..."}]}. ' +
        'No commentary, no markdown fences.',
      text,
      512,
    );
    if (!res) return stubExtractEntities(text);
    try {
      const parsed = JSON.parse(res) as EntityExtractionResult;
      if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) {
        return stubExtractEntities(text);
      }
      return parsed;
    } catch {
      logger.error('OpenRouter entity-extraction reply was not valid JSON; falling back to stub');
      return stubExtractEntities(text);
    }
  }

  private headers() {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      // Recommended by OpenRouter to attribute traffic; harmless if ignored.
      'HTTP-Referer': 'https://github.com/anthropics',
      'X-Title': 'MemoryOS',
    };
  }

  private async complete(system: string, userText: string, maxTokens: number): Promise<string | null> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'OpenRouter completion call failed; falling back to stub');
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content?.trim() ?? null;
  }
}

let cached: LlmProvider | null = null;

/**
 * Resolves the provider to use based on which API keys are configured — stub if none.
 *
 * Precedence when multiple keys are set:
 *  - Extraction/completion (extract, label, summarize, rerank, answer, entities): OpenRouter wins
 *    over Anthropic if OPENROUTER_API_KEY is set (it can route to any model, including Claude),
 *    otherwise Anthropic, otherwise stub.
 *  - Embedding: OpenAI wins if OPENAI_API_KEY is set (first-party embeddings API), otherwise
 *    OpenRouter's proxied embeddings if OPENROUTER_API_KEY is set, otherwise the deterministic
 *    hash embedding.
 */
export function getLlmProvider(): LlmProvider {
  if (cached) return cached;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openRouterModel = process.env.OPENROUTER_MODEL;

  if (!anthropicKey && !openAiKey && !openRouterKey) {
    cached = stubLlmProvider;
    return cached;
  }

  const openRouter = openRouterKey
    ? new OpenRouterLlmProvider(openRouterKey, openRouterModel || undefined)
    : null;
  const extraction = openRouter ?? (anthropicKey ? new AnthropicLlmProvider(anthropicKey) : stubLlmProvider);
  const embedding = openAiKey ? new OpenAiEmbeddingProvider(openAiKey) : openRouter;

  cached = {
    extractMemoryCandidates: (snippet) => extraction.extractMemoryCandidates(snippet),
    embed: (text) => (embedding ? embedding.embed(text) : Promise.resolve(hashEmbed(text))),
    suggestCategoryLabel: (content) => extraction.suggestCategoryLabel(content),
    summarize: (text) => extraction.summarize(text),
    rerank: (query, candidates) => extraction.rerank(query, candidates),
    answerWithContext: (question, chunks) => extraction.answerWithContext(question, chunks),
    extractEntities: (text) => extraction.extractEntities(text),
  };
  return cached;
}

/** Test-only escape hatch so suites can inject a fake provider instead of the singleton. */
export function __setLlmProviderForTests(provider: LlmProvider | null) {
  cached = provider;
}

export const EMBEDDING_DIMENSIONS = EMBEDDING_DIM;
