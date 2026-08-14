import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getLlmProvider, type CuratorClusterItem, type CuratorProposal } from '../../shared/providers/llm.provider';
import { tokenCount } from '../../shared/tokenizer';

// Phase 19 (ADR-0004): unifies the old duplicate-detection.service.ts and stale-detection.service.ts
// into one Memory Suggestions curator — one clustering pass per memory, one proposal, instead of
// two independent full-bucket pairwise scans producing two parallel suggestion types.
//
// Same cosine-distance calibration those two services used (docs/Phase2_Implementation_Plan.md
// §5.2 against the stub embedding provider): near-identical text lands under 0.15, related-but-
// distinct pairs land in the 0.15–0.55 band, unrelated text lands well above it — this is the
// cluster-membership ceiling below.
export const CURATOR_DUPLICATE_DISTANCE_THRESHOLD = 0.15;
export const CURATOR_CLUSTER_DISTANCE_CEILING = 0.55;

// Near-verbatim rewrites (punctuation, casing, a typo) score at or near 1.0 here; a genuine
// contradiction ("lives in Berlin" -> "now lives in Lisbon") sharing a long template but one
// changed fact typically lands well below this — raised from Phase 18.4's original 0.6 after
// calibration showed 0.6 let exactly that kind of contradiction get caught as a "near-duplicate"
// (the character-trigram measure can't tell "one word changed" from "unrelated"), which would have
// misfired as "remove" instead of reaching the curator for a real update/combine judgment.
export const CURATOR_TRIGRAM_SIMILARITY_THRESHOLD = 0.85;

// MemoryPlugin_Clone_Spec.md §5.2: "skips any memory over 10,000 tokens during analysis — too
// expensive to compare, unlikely to be a duplicate anyway." Applies to the trigger memory AND to
// any candidate cluster member — a memory this large never enters the analysis on either side.
export const CURATOR_TOKEN_SKIP_CEILING = 10_000;

const CURATOR_CLUSTER_SIZE = 5;

interface ClusterRow {
  id: string;
  content: string;
  createdAt: Date;
}

async function alreadySuggested(type: string, ids: string[]): Promise<boolean> {
  const sortedIds = [...ids].sort();
  const candidates = await prisma.memorySuggestion.findMany({
    where: { type, memoryIds: { hasSome: ids } },
    select: { memoryIds: true },
  });
  return candidates.some((c) => {
    const candidateSorted = [...c.memoryIds].sort();
    return candidateSorted.length === sortedIds.length && candidateSorted.every((id, i) => id === sortedIds[i]);
  });
}

// Tier 1/2 (exact + fuzzy): an unambiguous duplicate never needs a model's opinion — propose
// "remove" directly, targeting whichever of the pair is newer (the original stays), with the
// older memory carried alongside purely as display context for the reviewer.
async function proposeAutoRemove(userId: string, target: ClusterRow, match: ClusterRow): Promise<void> {
  const [newer, older] = match.createdAt > target.createdAt ? [match, target] : [target, match];
  const memoryIds = [newer.id, older.id];
  if (await alreadySuggested('remove', memoryIds)) return;
  await prisma.memorySuggestion.create({ data: { userId, type: 'remove', memoryIds } });
}

// Phase 19 (ADR-0004): "every model-returned ID is re-validated against the input set and
// re-checked for ownership before any write — models will confidently invent IDs, and this check
// is the only thing standing between that and a corrupted store." `clusterIds` is built directly
// from rows this same run already fetched via a bucket-scoped query, so membership in it already
// implies ownership — there is no separate ownership check to bypass.
async function createValidatedSuggestion(
  userId: string,
  clusterIds: Set<string>,
  proposal: CuratorProposal,
): Promise<void> {
  if (proposal.action === 'none') return;

  if (proposal.action === 'remove') {
    if (!clusterIds.has(proposal.memoryId)) {
      logger.error({ memoryId: proposal.memoryId }, 'Curator proposed removing a memory id outside its own cluster; discarding the proposal');
      return;
    }
    if (await alreadySuggested('remove', [proposal.memoryId])) return;
    await prisma.memorySuggestion.create({ data: { userId, type: 'remove', memoryIds: [proposal.memoryId] } });
    return;
  }

  if (proposal.action === 'update') {
    if (!clusterIds.has(proposal.memoryId)) {
      logger.error({ memoryId: proposal.memoryId }, 'Curator proposed updating a memory id outside its own cluster; discarding the proposal');
      return;
    }
    if (await alreadySuggested('update', [proposal.memoryId])) return;
    await prisma.memorySuggestion.create({
      data: { userId, type: 'update', memoryIds: [proposal.memoryId], draftContent: proposal.content },
    });
    return;
  }

  // combine
  const uniqueIds = [...new Set(proposal.memoryIds)];
  if (uniqueIds.length < 2 || uniqueIds.some((id) => !clusterIds.has(id))) {
    logger.error({ memoryIds: proposal.memoryIds }, 'Curator proposed a combine referencing an id outside its own cluster, or fewer than two memories; discarding the proposal');
    return;
  }
  if (await alreadySuggested('combine', uniqueIds)) return;
  await prisma.memorySuggestion.create({
    data: { userId, type: 'combine', memoryIds: uniqueIds, draftContent: proposal.content },
  });
}

export const curatorService = {
  /**
   * Runs the curator for one memory: cluster its nearest active neighbors in the same bucket,
   * propose at most one edit (or none), validate, and create a suggestion. Called fire-and-forget
   * after a memory is embedded (embedding.service.ts) — never blocks the write path.
   */
  async run(userId: string, memoryId: string): Promise<void> {
    const memory = await prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory) return;
    if (tokenCount(memory.content) > CURATOR_TOKEN_SKIP_CEILING) return;

    const target: ClusterRow = { id: memory.id, content: memory.content, createdAt: memory.createdAt };

    // Tier 1 — exact match: a plain case-insensitive equality check, no vector or trigram
    // machinery, and no LLM call at all.
    const exactMatches = await prisma.$queryRaw<ClusterRow[]>`
      SELECT id, content, "createdAt" FROM "Memory"
      WHERE "bucketId" = ${memory.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND lower(content) = lower(${memory.content})
    `;
    if (exactMatches.length > 0) {
      for (const match of exactMatches) await proposeAutoRemove(userId, target, match);
      return;
    }

    // Tier 2 — fuzzy match: pg_trgm similarity, catching near-verbatim rewrites the exact tier's
    // strict equality can't.
    const fuzzyMatches = await prisma.$queryRaw<ClusterRow[]>`
      SELECT id, content, "createdAt" FROM "Memory"
      WHERE "bucketId" = ${memory.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND similarity(content, ${memory.content}) >= ${CURATOR_TRIGRAM_SIMILARITY_THRESHOLD}
    `;
    if (fuzzyMatches.length > 0) {
      for (const match of fuzzyMatches) await proposeAutoRemove(userId, target, match);
      return;
    }

    // Tier 3 — genuinely ambiguous: cluster by embedding distance and hand the small cluster to
    // one model call, per ADR-0004 ("pulls each memory's nearest neighbors, hands the small
    // cluster to a cheap/fast LLM, asks for one of the three moves").
    const neighborRows = await prisma.$queryRaw<(ClusterRow & { distance: number })[]>`
      SELECT id, content, "createdAt", (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) AS distance
      FROM "Memory"
      WHERE "bucketId" = ${memory.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND embedding IS NOT NULL
        AND (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) <= ${CURATOR_CLUSTER_DISTANCE_CEILING}
      ORDER BY distance ASC
      LIMIT ${CURATOR_CLUSTER_SIZE}
    `;
    const neighbors: CuratorClusterItem[] = neighborRows
      .filter((n) => tokenCount(n.content) <= CURATOR_TOKEN_SKIP_CEILING)
      .map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt }));
    if (neighbors.length === 0) return;

    const proposal = await getLlmProvider().proposeCuratorAction(target, neighbors);
    const clusterIds = new Set([target.id, ...neighbors.map((n) => n.id)]);
    await createValidatedSuggestion(userId, clusterIds, proposal);
  },

  /**
   * The spec's "Check for new" manual scan action (MemoryPlugin_Clone_Spec.md §5.2): re-runs the
   * curator across every active memory in one bucket, for whatever hasn't been covered by the
   * fire-and-forget per-save pass (e.g. memories that existed before the curator did).
   */
  async scanBucket(userId: string, bucketId: string): Promise<{ scanned: number }> {
    const memories = await prisma.memory.findMany({
      where: { bucketId, status: 'active' },
      select: { id: true },
    });
    for (const memory of memories) {
      await this.run(userId, memory.id);
    }
    return { scanned: memories.length };
  },
};
