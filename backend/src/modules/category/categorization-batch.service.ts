import { prisma } from '../../shared/prisma';
import { getLlmProvider, callProvider } from '../../shared/providers/llm.provider';
import { tokenCount } from '../../shared/tokenizer';
import { parseVectorLiteral, toVectorLiteral } from '../../shared/vector';

// MemoryPlugin_Clone_Spec.md §5.1's gating: below this there's nothing meaningful to cluster; above
// either ceiling this is refused with a clear "too large to categorize yet" result rather than
// attempted and left to time out on a bucket too big to embed-cluster and LLM-label synchronously.
export const MIN_MEMORIES_TO_CATEGORIZE = 30;
export const MAX_MEMORIES_TO_CATEGORIZE = 2000;
export const MAX_TOKENS_TO_CATEGORIZE = 600_000;

// Same first-calibrated-guess distance band the retired categorization.service.ts used
// (docs/Phase4_Implementation_Plan.md §5.2) — greedy nearest-running-centroid clustering, just as
// one in-memory batch pass over the whole bucket instead of incrementally per save (ADR-0006).
export const CATEGORY_DISTANCE_THRESHOLD = 0.35;

interface EligibleMemory {
  id: string;
  content: string;
  embedding: number[];
}

interface Cluster {
  centroid: number[];
  members: EligibleMemory[];
}

export type RecategorizeResult =
  | { status: 'too_few'; memoryCount: number; minimum: number }
  | { status: 'too_large'; memoryCount: number; tokenCount: number; maxMemories: number; maxTokens: number }
  | {
      status: 'ok';
      categories: { id: string; label: string; summary: string; additionalContext: string; memoryCount: number }[];
    };

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Greedy single pass in creation order: each memory joins the closest existing cluster within
// threshold (running-average centroid updated in plain JS — the same reason
// categorization.service.ts computed its centroid update in the application layer instead of SQL
// applies here: the installed pgvector version has no vector/scalar divide), or starts a new one.
function clusterByDistance(memories: EligibleMemory[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const memory of memories) {
    let best: { cluster: Cluster; distance: number } | null = null;
    for (const cluster of clusters) {
      const distance = cosineDistance(memory.embedding, cluster.centroid);
      if (distance <= CATEGORY_DISTANCE_THRESHOLD && (!best || distance < best.distance)) {
        best = { cluster, distance };
      }
    }
    if (best) {
      best.cluster.members.push(memory);
      const n = best.cluster.members.length;
      best.cluster.centroid = best.cluster.centroid.map((v, i) => v + (memory.embedding[i] - v) / n);
    } else {
      clusters.push({ centroid: [...memory.embedding], members: [memory] });
    }
  }
  return clusters;
}

// Every cluster is labeled independently by the LLM in the same run, all against an empty bucket
// (categories are wiped up front — see recategorize() below), so a collision only means two
// clusters proposed the same name this run; a plain in-memory set is enough to disambiguate.
function resolveUniqueLabel(used: Set<string>, label: string): string {
  let candidate = label;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${label} ${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

export const categorizationBatchService = {
  /**
   * MemoryPlugin_Clone_Spec.md §5.1: reads every active, embedded memory in one bucket, clusters
   * them by embedding distance, and asks the LLM to name + summarize each resulting group. Replaces
   * whatever categorization the bucket already had — idempotent re-run, not additive (ADR-0006) —
   * and never partially applies: every cluster's LLM call must succeed before any write happens, so
   * a mid-run provider outage leaves the bucket's prior categorization untouched.
   */
  async recategorize(bucketId: string): Promise<RecategorizeResult> {
    const rows = await prisma.$queryRaw<{ id: string; content: string; embedding: string }[]>`
      SELECT id, content, embedding::text AS embedding
      FROM "Memory"
      WHERE "bucketId" = ${bucketId} AND status = 'active' AND embedding IS NOT NULL
      ORDER BY "createdAt" ASC
    `;

    if (rows.length < MIN_MEMORIES_TO_CATEGORIZE) {
      return { status: 'too_few', memoryCount: rows.length, minimum: MIN_MEMORIES_TO_CATEGORIZE };
    }

    const totalTokens = rows.reduce((sum, r) => sum + tokenCount(r.content), 0);
    if (rows.length > MAX_MEMORIES_TO_CATEGORIZE || totalTokens > MAX_TOKENS_TO_CATEGORIZE) {
      return {
        status: 'too_large',
        memoryCount: rows.length,
        tokenCount: totalTokens,
        maxMemories: MAX_MEMORIES_TO_CATEGORIZE,
        maxTokens: MAX_TOKENS_TO_CATEGORIZE,
      };
    }

    const memories: EligibleMemory[] = rows.map((r) => ({
      id: r.id,
      content: r.content,
      embedding: parseVectorLiteral(r.embedding),
    }));
    const clusters = clusterByDistance(memories);

    const provider = getLlmProvider();
    const usedLabels = new Set<string>();
    const labeled: { cluster: Cluster; label: string; summary: string; additionalContext: string }[] = [];
    for (const cluster of clusters) {
      const result = await callProvider(
        () => provider.categorizeCluster(cluster.members.map((m) => ({ id: m.id, content: m.content }))),
        'Could not categorize this bucket right now — the AI provider is temporarily unavailable.',
      );
      labeled.push({ cluster, label: resolveUniqueLabel(usedLabels, result.label), summary: result.summary, additionalContext: result.additionalContext });
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.category.deleteMany({ where: { bucketId } });

      const rows: { id: string; label: string; summary: string; additionalContext: string; memoryCount: number }[] = [];
      for (const { cluster, label, summary, additionalContext } of labeled) {
        const category = await tx.category.create({
          data: { bucketId, label, summary, additionalContext, memoryCount: cluster.members.length },
        });
        await tx.$executeRaw`
          UPDATE "Category" SET centroid = ${toVectorLiteral(cluster.centroid)}::vector WHERE id = ${category.id}
        `;
        await tx.memory.updateMany({
          where: { id: { in: cluster.members.map((m) => m.id) } },
          data: { categoryId: category.id },
        });
        rows.push({ id: category.id, label, summary, additionalContext, memoryCount: cluster.members.length });
      }
      return rows;
    });

    return { status: 'ok', categories: created };
  },
};
