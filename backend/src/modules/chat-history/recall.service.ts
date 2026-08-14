import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { toVectorLiteral } from '../../shared/vector';
import { getLlmProvider, callProvider } from '../../shared/providers/llm.provider';
import { tokenCount } from '../../shared/tokenizer';
import { reciprocalRankFusion, fuseAcrossVariants } from './rank-fusion';

// Plan §4: "feed the fused pool, not a raw top-K" — each retriever over-fetches so the fused pool
// comfortably clears the ≥100-candidate target the rerank stage (Phase 17 Stage 3) needs, even
// though a small seeded account will legitimately fuse far fewer than 100 *distinct* chunks.
const DENSE_CANDIDATE_LIMIT = 100;
const KEYWORD_CANDIDATE_LIMIT = 100;

export interface DateFilter {
  after?: Date;
  before?: Date;
}

function dateFilterSql(dateFilter?: DateFilter) {
  return Prisma.sql`
    ${dateFilter?.after ? Prisma.sql`AND m."createdAt" >= ${dateFilter.after}` : Prisma.empty}
    ${dateFilter?.before ? Prisma.sql`AND m."createdAt" <= ${dateFilter.before}` : Prisma.empty}
  `;
}

/**
 * Stage 2a — the dense half of hybrid search: MessageChunk ids ranked by ascending cosine
 * distance against the query embedding, scoped to accessible buckets. Same query shape
 * chat-search.service.ts already uses, without collapsing to one row per conversation — the
 * recall pipeline fuses and reranks at chunk granularity, not conversation granularity.
 * `dateFilter` is Stage 1's date-bound extraction, threaded down here rather than applied as a
 * post-filter, so a date-scoped query narrows what gets ranked, not just what gets shown.
 */
export async function denseSearch(
  bucketIds: string[],
  embedding: number[],
  limit = DENSE_CANDIDATE_LIMIT,
  dateFilter?: DateFilter,
): Promise<string[]> {
  if (bucketIds.length === 0) return [];
  const vectorLiteral = toVectorLiteral(embedding);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT mc.id
    FROM "MessageChunk" mc
    JOIN "Message" m ON m.id = mc."messageId"
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."bucketId" IN (${Prisma.join(bucketIds)})
      AND mc.embedding IS NOT NULL
      ${dateFilterSql(dateFilter)}
    ORDER BY mc.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

/**
 * Stage 2b — the keyword half: MessageChunk ids ranked by `ts_rank` against the query, using the
 * `contentTsv` GIN index this phase's migration added. This is the BM25-equivalent retriever the
 * plan calls for "within pgvector" rather than standing up a second datastore.
 */
export async function keywordSearch(
  bucketIds: string[],
  query: string,
  limit = KEYWORD_CANDIDATE_LIMIT,
  dateFilter?: DateFilter,
): Promise<string[]> {
  if (bucketIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT mc.id
    FROM "MessageChunk" mc
    JOIN "Message" m ON m.id = mc."messageId"
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."bucketId" IN (${Prisma.join(bucketIds)})
      AND mc."contentTsv" @@ plainto_tsquery('english', ${query})
      ${dateFilterSql(dateFilter)}
    ORDER BY ts_rank(mc."contentTsv", plainto_tsquery('english', ${query})) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

/**
 * Stage 2 — one query variant's fused ranked list of MessageChunk ids: dense and keyword run
 * concurrently, then fuse by rank via `reciprocalRankFusion` (§7.3 — never a weighted raw-score
 * sum). `recall()` calls this once per Stage 1 variant and fuses those lists again with
 * `fuseAcrossVariants`; with a single variant, this function's own output *is* the pipeline's
 * fused candidate pool.
 */
export async function hybridSearchOneVariant(
  bucketIds: string[],
  variantQuery: string,
  embedding: number[],
  dateFilter?: DateFilter,
): Promise<string[]> {
  const [dense, keyword] = await Promise.all([
    denseSearch(bucketIds, embedding, DENSE_CANDIDATE_LIMIT, dateFilter),
    keywordSearch(bucketIds, variantQuery, KEYWORD_CANDIDATE_LIMIT, dateFilter),
  ]);
  return reciprocalRankFusion([dense, keyword]);
}

export interface RecallChunkRow {
  id: string;
  messageId: string;
  content: string;
  position: number;
  createdAt: Date;
  conversationId: string;
  title: string;
  platform: string;
}

/** Loads full rows for a fused id list, preserving the fused order (Postgres does not). */
export async function loadChunkRows(chunkIds: string[]): Promise<RecallChunkRow[]> {
  if (chunkIds.length === 0) return [];
  const rows = await prisma.$queryRaw<RecallChunkRow[]>`
    SELECT mc.id, mc."messageId", mc.content, m.position, m."createdAt", c.id AS "conversationId", c.title, c.platform
    FROM "MessageChunk" mc
    JOIN "Message" m ON m.id = mc."messageId"
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE mc.id IN (${Prisma.join(chunkIds)})
  `;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return chunkIds.map((id) => byId.get(id)).filter((r): r is RecallChunkRow => Boolean(r));
}

export interface NeighborMessage {
  position: number;
  role: string;
  content: string;
}

export interface ExpandedChunk extends RecallChunkRow {
  before: NeighborMessage | null;
  after: NeighborMessage | null;
}

/**
 * Stage 5 — the exchange around each surviving hit, not an isolated sentence: the immediately
 * preceding and following message in the same conversation. One batched query across every row
 * (not one query per row) regardless of how many hits or conversations are involved.
 */
export async function expandContext(rows: RecallChunkRow[]): Promise<ExpandedChunk[]> {
  if (rows.length === 0) return [];

  const wantedPositions = new Map<string, Set<number>>();
  for (const row of rows) {
    const positions = wantedPositions.get(row.conversationId) ?? new Set<number>();
    positions.add(row.position - 1);
    positions.add(row.position + 1);
    wantedPositions.set(row.conversationId, positions);
  }

  const neighbors = await prisma.message.findMany({
    where: {
      OR: [...wantedPositions.entries()].flatMap(([conversationId, positions]) =>
        [...positions].map((position) => ({ conversationId, position })),
      ),
    },
    select: { conversationId: true, position: true, role: true, content: true },
  });
  const byKey = new Map(neighbors.map((n) => [`${n.conversationId}:${n.position}`, n]));

  return rows.map((row) => ({
    ...row,
    before: byKey.get(`${row.conversationId}:${row.position - 1}`) ?? null,
    after: byKey.get(`${row.conversationId}:${row.position + 1}`) ?? null,
  }));
}

/**
 * Stage 3 — reorders the fused candidate pool (not a raw top-K — see hybridSearchOneVariant's
 * comment) by true query relevance via the LLM-prompted reranker. A row `rerank()` doesn't
 * mention in its returned order is dropped rather than kept at some arbitrary position — the
 * reranker is the one place ordering authority lives once this stage has run.
 */
export async function rerankRows(query: string, rows: RecallChunkRow[]): Promise<RecallChunkRow[]> {
  if (rows.length <= 1) return rows;
  const order = await callProvider(
    () => getLlmProvider().rerank(query, rows.map((r) => ({ id: r.id, content: r.content }))),
    'Could not rank these results right now — the AI provider is temporarily unavailable.',
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return order.map((id) => byId.get(id)).filter((r): r is RecallChunkRow => Boolean(r));
}

/**
 * Stage 4 — drops candidates the LLM judges don't actually answer the query, not just resemble
 * it. Runs after rerank per the spec's own stage order, on whatever pool rerank (or hybrid search
 * alone, if rerank was skipped) produced.
 */
export async function filterByRelevance(query: string, rows: RecallChunkRow[]): Promise<RecallChunkRow[]> {
  if (rows.length === 0) return [];
  const relevantIds = new Set(
    await callProvider(
      () => getLlmProvider().assessChunkRelevance(query, rows.map((r) => ({ id: r.id, content: r.content }))),
      'Could not filter these results right now — the AI provider is temporarily unavailable.',
    ),
  );
  return rows.filter((r) => relevantIds.has(r.id));
}

export interface RecallOptions {
  /** Stage 1: LLM query-expansion into first-person variants + date-filter extraction. */
  expandQuery?: boolean;
  /** Stage 3: LLM-prompted rerank of the fused pool. */
  rerank?: boolean;
  /** Stage 4: per-chunk LLM relevance assessment — the step that dominates latency. */
  assessRelevance?: boolean;
}

/**
 * The one seam every caller (the `search`/`inject` REST endpoints, the `recall_chat_history` MCP
 * tool) goes through — stages 1, 2, 3, 4, 5 composed in the spec's own order, each individually
 * toggleable so a cheap/fast caller can skip the expensive stages (rerank, relevance) without a
 * second, parallel implementation to keep in sync. Stage 6 (summarization) is deliberately not
 * included here: it's the one stage some callers skip entirely (raw search, no synthesis) — see
 * `recallAndSummarize` for the composition that adds it back on top of this.
 */
export async function recall(bucketIds: string[], query: string, opts: RecallOptions = {}): Promise<ExpandedChunk[]> {
  const provider = getLlmProvider();

  let variants: string[];
  let dateFilter: DateFilter | undefined;
  if (opts.expandQuery) {
    const expanded = await callProvider(
      () => provider.expandQuery(query, new Date()),
      'Could not expand your search query right now — the AI provider is temporarily unavailable.',
    );
    variants = expanded.variants;
    dateFilter = expanded.dateFilter;
  } else {
    variants = [query];
  }

  const perVariantFused = await Promise.all(
    variants.map(async (variant) => {
      const embedding = await callProvider(
        () => provider.embed(variant),
        'Could not search your chat history right now — the AI provider is temporarily unavailable.',
      );
      return hybridSearchOneVariant(bucketIds, variant, embedding, dateFilter);
    }),
  );
  const fusedIds = variants.length > 1 ? fuseAcrossVariants(perVariantFused) : (perVariantFused[0] ?? []);

  let rows = await loadChunkRows(fusedIds);
  if (opts.rerank) rows = await rerankRows(query, rows);
  if (opts.assessRelevance) rows = await filterByRelevance(query, rows);
  return expandContext(rows);
}

export interface RecallCitation {
  conversationId: string;
  title: string;
  messageId: string;
  createdAt: Date;
}

export interface RecallSummary {
  summary: string;
  citations: RecallCitation[];
}

// ADR-0005's map-reduce fold triggers once survivors exceed roughly one summarization pass —
// this is a per-*batch* ceiling, not the final tokenBudget (a 600-token summary can legitimately
// be folded from several thousand tokens of source material across multiple batches).
const MAP_REDUCE_BATCH_TOKEN_CEILING = 4000;

/** Greedily groups rows so each batch's total content stays within `ceiling` — never an empty
 * batch, even if a single row's content alone exceeds it. */
export function batchByTokenCeiling(rows: RecallChunkRow[], ceiling: number): RecallChunkRow[][] {
  const batches: RecallChunkRow[][] = [];
  let current: RecallChunkRow[] = [];
  let currentTokens = 0;
  for (const row of rows) {
    const rowTokens = tokenCount(row.content);
    if (current.length > 0 && currentTokens + rowTokens > ceiling) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(row);
    currentTokens += rowTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Stage 6 — the final assembly: `recall()`'s survivors folded into one query-shaped, cited
 * summary within `tokenBudget` (ADR-0005: read-time, not a pre-computed digest). Conversations
 * too large for one pass go through a progressive map-reduce fold — summarize a batch, carry the
 * running summary into the next — rather than one giant context call.
 */
export async function recallAndSummarize(
  bucketIds: string[],
  query: string,
  opts: RecallOptions & { tokenBudget: number },
): Promise<RecallSummary> {
  const rows = await recall(bucketIds, query, opts);
  if (rows.length === 0) return { summary: '', citations: [] };

  const provider = getLlmProvider();
  const batches = batchByTokenCeiling(rows, MAP_REDUCE_BATCH_TOKEN_CEILING);

  let runningSummary: string | undefined;
  const citedIds = new Set<string>();
  for (const batch of batches) {
    const result = await callProvider(
      () =>
        provider.summarizeWithCitations(
          query,
          batch.map((r) => ({ id: r.id, content: r.content })),
          { tokenBudget: opts.tokenBudget, priorSummary: runningSummary },
        ),
      'Could not summarize your chat history right now — the AI provider is temporarily unavailable.',
    );
    runningSummary = result.summary;
    result.citedIds.forEach((id) => citedIds.add(id));
  }

  const citations = rows
    .filter((r) => citedIds.has(r.id))
    .map((r) => ({ conversationId: r.conversationId, title: r.title, messageId: r.messageId, createdAt: r.createdAt }));

  return { summary: runningSummary ?? '', citations };
}
