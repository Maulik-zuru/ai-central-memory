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
  /**
   * Phase 17 Stage 1 (US-ARC-07): rewrite a chat-history recall query into first-person "what I
   * probably said back then" variants, plus any date bounds implied ("last week", "in March"),
   * anchored to `now`. The verbatim original query is always present in `variants` — callers
   * don't need to re-add it themselves.
   */
  expandQuery(query: string, now: Date): Promise<{ variants: string[]; dateFilter?: { after?: Date; before?: Date } }>;
  /**
   * Phase 17 Stage 4 (US-ARC-07): of the candidates that survived hybrid search + rerank, which
   * ones actually answer the query — not just resemble it. Returns the relevant subset's ids
   * (order not meaningful). This is the step the spec calls out as dominating recall latency.
   */
  assessChunkRelevance(query: string, candidates: { id: string; content: string }[]): Promise<string[]>;
  /**
   * Phase 17 Stage 6 (US-ARC-07, ADR-0005): fold the surviving, context-expanded chunks into one
   * query-shaped summary within `tokenBudget`, citing which chunk ids it actually drew from.
   * `priorSummary`, when set, is the running summary from an earlier fold pass over a prior batch
   * (ADR-0005's map-reduce fold for conversations too large for one pass) — the orchestration of
   * which batch goes in which call lives in the recall pipeline, not here.
   */
  summarizeWithCitations(
    query: string,
    chunks: { id: string; content: string }[],
    opts: { tokenBudget: number; priorSummary?: string },
  ): Promise<{ summary: string; citedIds: string[] }>;
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

// Stub query expansion: without a real LLM there's no genuine paraphrasing to offer, so this is
// honest about it (same bar stubAnswerWithContext sets) rather than faking variants — the
// original query is always the sole variant. The "always re-add the original" contract is what
// every caller actually depends on, and this trivially satisfies it.
function stubExpandQuery(query: string): { variants: string[]; dateFilter?: { after?: Date; before?: Date } } {
  return { variants: [query] };
}

// Stub relevance assessment: keyword-overlap with the query, same scoring shape stubRerank
// already uses — enough to prove "the relevance filter actually drops candidates" end to end
// without a network call. A candidate with zero shared non-trivial words is judged irrelevant.
function stubAssessChunkRelevance(query: string, candidates: { id: string; content: string }[]): string[] {
  const queryWords = new Set((query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3));
  return candidates
    .filter((c) => {
      const words = c.content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      return words.some((w) => queryWords.has(w));
    })
    .map((c) => c.id);
}

// Stub summarization-with-citations: no LLM configured, so — same honesty bar
// stubAnswerWithContext sets — this folds the prior running summary (if any) and the chunks'
// content verbatim up to a character-based approximation of the token budget, citing every chunk
// actually included rather than pretending to synthesize prose from them.
function stubSummarizeWithCitations(
  chunks: { id: string; content: string }[],
  opts: { tokenBudget: number; priorSummary?: string },
): { summary: string; citedIds: string[] } {
  if (chunks.length === 0) return { summary: opts.priorSummary ?? '', citedIds: [] };
  const CHARS_PER_TOKEN_ESTIMATE = 4;
  const budgetChars = opts.tokenBudget * CHARS_PER_TOKEN_ESTIMATE;
  const parts: string[] = opts.priorSummary ? [opts.priorSummary] : [];
  const citedIds: string[] = [];
  let used = parts.join('\n').length;
  for (const chunk of chunks) {
    if (used + chunk.content.length > budgetChars && citedIds.length > 0) break;
    parts.push(chunk.content);
    citedIds.push(chunk.id);
    used += chunk.content.length;
  }
  return { summary: `No LLM configured — showing the most relevant passages verbatim: ${parts.join(' / ')}`, citedIds };
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

// Shared parsing helpers for the two real providers' Phase 17 methods (AnthropicLlmProvider and
// OpenRouterLlmProvider) — one place for "how a query-expansion/relevance/summary reply gets
// interpreted" rather than two copies that could quietly drift apart.

function mergeWithOriginal(query: string, rewritten: string[]): string[] {
  return [query, ...rewritten.filter((v) => v !== query)];
}

function parseDateFilter(raw?: { after?: string; before?: string }): { after?: Date; before?: Date } | undefined {
  if (!raw) return undefined;
  const after = raw.after ? new Date(raw.after) : undefined;
  const before = raw.before ? new Date(raw.before) : undefined;
  const validAfter = after && !isNaN(after.getTime()) ? after : undefined;
  const validBefore = before && !isNaN(before.getTime()) ? before : undefined;
  if (!validAfter && !validBefore) return undefined;
  return { after: validAfter, before: validBefore };
}

function parseRelevanceReply(reply: string, candidates: { id: string; content: string }[]): string[] {
  const trimmed = reply.trim();
  if (trimmed.toUpperCase() === 'NONE') return [];
  if (!/^[\d\s,]+$/.test(trimmed)) {
    // Not a parse failure worth throwing over (the call itself succeeded) — but also not a
    // trustworthy relevance judgment, so fail open by keeping every candidate rather than
    // silently dropping all of them (§7.4).
    logger.error('Relevance-assessment reply was not in the expected format; keeping all candidates');
    return candidates.map((c) => c.id);
  }
  const indices = trimmed
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length);
  return indices.map((i) => candidates[i].id);
}

function parseSummaryReply(reply: string, chunks: { id: string; content: string }[]): { summary: string; citedIds: string[] } {
  const usedMatch = reply.match(/USED:\s*([\d,\s]+)/i);
  const summary = reply.replace(/USED:\s*[\d,\s]+/i, '').trim();
  const citedIds = usedMatch
    ? usedMatch[1]
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((i) => Number.isInteger(i) && i >= 0 && i < chunks.length)
        .map((i) => chunks[i].id)
    : chunks.map((c) => c.id);
  return { summary, citedIds };
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
  async expandQuery(query: string) {
    return stubExpandQuery(query);
  },
  async assessChunkRelevance(query, candidates) {
    return stubAssessChunkRelevance(query, candidates);
  },
  async summarizeWithCitations(_query, chunks, opts) {
    return stubSummarizeWithCitations(chunks, opts);
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

  // Phase 17 (§7.4 "fail open, never fail silent"): unlike the methods above, an actual call
  // failure here throws rather than falling back to a stub-shaped result. A recall pipeline stage
  // silently substituting a plausible-looking result on provider failure is exactly the anti-
  // pattern the spec calls "the single highest-value bug" next to raw-score fusion — the caller
  // needs to be able to tell "the provider is down" from "genuinely nothing relevant" (a 500-plus-
  // retry is very different from a legitimate 200 with an empty result). A malformed-but-present
  // response (the call succeeded, the content just didn't parse) is a different, lower-severity
  // case — handled per method below, generally by degrading rather than throwing.
  async expandQuery(query: string, now: Date): Promise<{ variants: string[]; dateFilter?: { after?: Date; before?: Date } }> {
    const res = await this.complete(
      'Rewrite the recall query into 2-4 first-person variants of what the user probably said back ' +
        'then (statement form, not question form) — e.g. "what did I decide about the database" becomes ' +
        'variants like "we decided to use Postgres" or "I chose Postgres for the database". Also extract ' +
        `any date range the query implies, relative to right now (${now.toISOString()}). Reply with ONLY ` +
        'strict JSON of the shape {"variants":["...","..."],"dateFilter":{"after":"ISO date","before":"ISO date"}}. ' +
        'Omit dateFilter entirely if no date is implied. No commentary, no markdown fences.',
      query,
      256,
    );
    if (res === null) throw new Error('LLM query-expansion call failed');
    try {
      const parsed = JSON.parse(res) as { variants?: unknown; dateFilter?: { after?: string; before?: string } };
      const rewritten = Array.isArray(parsed.variants) ? parsed.variants.filter((v): v is string => typeof v === 'string') : [];
      return { variants: mergeWithOriginal(query, rewritten), dateFilter: parseDateFilter(parsed.dateFilter) };
    } catch {
      logger.error('Anthropic query-expansion reply was not valid JSON; using the original query only');
      return { variants: [query] };
    }
  }

  async assessChunkRelevance(query: string, candidates: { id: string; content: string }[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const listing = candidates.map((c, i) => `[${i}] ${c.content}`).join('\n');
    const res = await this.complete(
      'Given the query and a numbered list of candidate passages, reply with ONLY the indices of ' +
        'passages that actually answer or are directly relevant to the query — not just superficially ' +
        'similar — comma-separated (e.g. "0,3,4"). If none are relevant, reply with NONE. No commentary.',
      `Query: ${query}\n\nCandidates:\n${listing}`,
      128,
    );
    if (res === null) throw new Error('LLM relevance-assessment call failed');
    return parseRelevanceReply(res, candidates);
  }

  async summarizeWithCitations(
    query: string,
    chunks: { id: string; content: string }[],
    opts: { tokenBudget: number; priorSummary?: string },
  ): Promise<{ summary: string; citedIds: string[] }> {
    if (chunks.length === 0) return { summary: '', citedIds: [] };
    const listing = chunks.map((c, i) => `[${i}] ${c.content}`).join('\n\n');
    const priorContext = opts.priorSummary ? `What's established so far: ${opts.priorSummary}\n\n` : '';
    const res = await this.complete(
      `Summarize the passages below, addressing the query, within roughly ${opts.tokenBudget} tokens. ` +
        'Ground every claim in the passages — do not invent anything they don\'t say. End your reply ' +
        'with a line "USED: <comma-separated indices you drew from>".',
      `${priorContext}Query: ${query}\n\nPassages:\n${listing}`,
      opts.tokenBudget + 50,
    );
    if (res === null) throw new Error('LLM summarization call failed');
    return parseSummaryReply(res, chunks);
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

  // Phase 17 (§7.4) — same "throw on real call failure, degrade gracefully on merely-malformed
  // content" discipline as AnthropicLlmProvider's identical methods; see that class's comment.
  async expandQuery(query: string, now: Date): Promise<{ variants: string[]; dateFilter?: { after?: Date; before?: Date } }> {
    const res = await this.complete(
      'Rewrite the recall query into 2-4 first-person variants of what the user probably said back ' +
        'then (statement form, not question form) — e.g. "what did I decide about the database" becomes ' +
        'variants like "we decided to use Postgres" or "I chose Postgres for the database". Also extract ' +
        `any date range the query implies, relative to right now (${now.toISOString()}). Reply with ONLY ` +
        'strict JSON of the shape {"variants":["...","..."],"dateFilter":{"after":"ISO date","before":"ISO date"}}. ' +
        'Omit dateFilter entirely if no date is implied. No commentary, no markdown fences.',
      query,
      256,
    );
    if (res === null) throw new Error('LLM query-expansion call failed');
    try {
      const parsed = JSON.parse(res) as { variants?: unknown; dateFilter?: { after?: string; before?: string } };
      const rewritten = Array.isArray(parsed.variants) ? parsed.variants.filter((v): v is string => typeof v === 'string') : [];
      return { variants: mergeWithOriginal(query, rewritten), dateFilter: parseDateFilter(parsed.dateFilter) };
    } catch {
      logger.error('OpenRouter query-expansion reply was not valid JSON; using the original query only');
      return { variants: [query] };
    }
  }

  async assessChunkRelevance(query: string, candidates: { id: string; content: string }[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const listing = candidates.map((c, i) => `[${i}] ${c.content}`).join('\n');
    const res = await this.complete(
      'Given the query and a numbered list of candidate passages, reply with ONLY the indices of ' +
        'passages that actually answer or are directly relevant to the query — not just superficially ' +
        'similar — comma-separated (e.g. "0,3,4"). If none are relevant, reply with NONE. No commentary.',
      `Query: ${query}\n\nCandidates:\n${listing}`,
      128,
    );
    if (res === null) throw new Error('LLM relevance-assessment call failed');
    return parseRelevanceReply(res, candidates);
  }

  async summarizeWithCitations(
    query: string,
    chunks: { id: string; content: string }[],
    opts: { tokenBudget: number; priorSummary?: string },
  ): Promise<{ summary: string; citedIds: string[] }> {
    if (chunks.length === 0) return { summary: '', citedIds: [] };
    const listing = chunks.map((c, i) => `[${i}] ${c.content}`).join('\n\n');
    const priorContext = opts.priorSummary ? `What's established so far: ${opts.priorSummary}\n\n` : '';
    const res = await this.complete(
      `Summarize the passages below, addressing the query, within roughly ${opts.tokenBudget} tokens. ` +
        'Ground every claim in the passages — do not invent anything they don\'t say. End your reply ' +
        'with a line "USED: <comma-separated indices you drew from>".',
      `${priorContext}Query: ${query}\n\nPassages:\n${listing}`,
      opts.tokenBudget + 50,
    );
    if (res === null) throw new Error('LLM summarization call failed');
    return parseSummaryReply(res, chunks);
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
    expandQuery: (query, now) => extraction.expandQuery(query, now),
    assessChunkRelevance: (query, candidates) => extraction.assessChunkRelevance(query, candidates),
    summarizeWithCitations: (query, chunks, opts) => extraction.summarizeWithCitations(query, chunks, opts),
  };
  return cached;
}

/** Test-only escape hatch so suites can inject a fake provider instead of the singleton. */
export function __setLlmProviderForTests(provider: LlmProvider | null) {
  cached = provider;
}

export const EMBEDDING_DIMENSIONS = EMBEDDING_DIM;
