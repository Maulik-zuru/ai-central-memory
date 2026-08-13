// Phase 17 (US-ARC-07 / MemoryPlugin_Clone_Spec.md §7.3): the single highest-value bug this
// module exists to make impossible — combining a bounded dense/cosine score with an unbounded
// BM25 score by weighted sum always lets the larger raw scale dominate regardless of the intended
// split. Reciprocal Rank Fusion never sees a raw score at all, only rank position, so a scale
// mismatch between retrievers has nothing to leak through.
const RRF_K = 60;

/**
 * Fuses any number of already-ranked (best-first) ID lists into one ranked list, using
 * `1/(k + rank + 1)` per list per document, summed across lists a document appears in.
 * A document absent from a list contributes nothing for that list — it isn't penalized beyond
 * simply not benefiting from that list's vote.
 */
export function reciprocalRankFusion(rankedLists: string[][], k = RRF_K): string[] {
  const scores = new Map<string, number>();
  const firstSeenOrder: string[] = [];

  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      if (!scores.has(id)) firstSeenOrder.push(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }

  // Stable sort on first-seen order breaks ties deterministically instead of leaving them to
  // whatever order Map iteration or the sort algorithm happens to produce.
  return firstSeenOrder.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
}

/**
 * Merges per-variant ranked lists (each already itself a fused, single ranked list — see
 * `reciprocalRankFusion`) by each document's *best* (lowest-index) rank across all variants —
 * never first-list-wins, per §7.3's explicit warning that the same discipline governing
 * retriever fusion applies to variant fusion too.
 */
export function fuseAcrossVariants(perVariantRankedLists: string[][]): string[] {
  const bestRank = new Map<string, number>();
  const firstSeenOrder: string[] = [];

  for (const list of perVariantRankedLists) {
    list.forEach((id, rank) => {
      if (!bestRank.has(id)) firstSeenOrder.push(id);
      const current = bestRank.get(id);
      if (current === undefined || rank < current) bestRank.set(id, rank);
    });
  }

  return firstSeenOrder.sort((a, b) => (bestRank.get(a) ?? Infinity) - (bestRank.get(b) ?? Infinity));
}
