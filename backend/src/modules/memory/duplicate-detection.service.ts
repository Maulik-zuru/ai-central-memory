import { prisma } from '../../shared/prisma';

// Cosine distance from pgvector's `<=>` operator: 0 = identical, 2 = opposite. This resolves the
// open question flagged in Product_Requirements.md §10 ("the exact similarity threshold... needs
// a concrete first value") — calibrated empirically against the stub embedding provider (see
// docs/Phase2_Implementation_Plan.md §5.2): near-identical text lands under 0.15, paraphrases and
// same-topic-different-value pairs land in the 0.15–0.55 band (handled by stale-detection),
// unrelated text lands well above that.
export const DUPLICATE_DISTANCE_THRESHOLD = 0.15;

// pg_trgm's `similarity()` returns 0 (nothing in common) to 1 (identical strings). Calibrated
// looser than the exact tier (which requires perfect equality) but tight enough that only
// near-verbatim rewrites — punctuation, capitalization, a single typo — match; anything looser is
// left for the embedding tier, which reasons about meaning rather than character overlap.
export const DUPLICATE_TRIGRAM_SIMILARITY_THRESHOLD = 0.6;

interface IdRow {
  id: string;
}

interface NeighborRow {
  id: string;
  distance: number;
}

async function createSuggestionIfNew(userId: string, memoryId: string, otherId: string): Promise<void> {
  const [memoryIdA, memoryIdB] = [memoryId, otherId].sort();

  // A prior suggestion for this exact pair — pending, approved, or dismissed — means it's already
  // been surfaced once. Dismissing must permanently silence the pair (US-MEM-06 AC).
  const existing = await prisma.memorySuggestion.findFirst({
    where: { type: 'duplicate', memoryIdA, memoryIdB },
  });
  if (existing) return;

  await prisma.memorySuggestion.create({
    data: { userId, type: 'duplicate', memoryIdA, memoryIdB },
  });
}

// Phase 3 widening (docs/Phase3_Implementation_Plan.md §3.1): candidates are scoped by bucket,
// not by creator — two different collaborators contributing near-identical facts to the same
// shared bucket must be flagged against each other, not just against their own other memories.
// `userId` is still recorded on the suggestion (who/what triggered it), but membership — not this
// field — governs who can see or act on it (suggestion.service.ts).
//
// Phase 18 (§7.4 "layered duplicate matching"): three tiers, cheapest first, each one a
// short-circuit — a memory that's already flagged by a cheaper tier never reaches a more
// expensive one. An exact rewrite doesn't need a trigram scan to prove it's a duplicate, and a
// near-verbatim rewrite doesn't need a vector index scan — the embedding tier is reserved for the
// genuinely ambiguous remainder neither cheaper tier resolved.
export const duplicateDetectionService = {
  async run(userId: string, memoryId: string): Promise<void> {
    const memory = await prisma.memory.findUnique({ where: { id: memoryId }, select: { bucketId: true, content: true } });
    if (!memory) return;

    // Tier 1 — exact match: a plain case-insensitive equality check, no vector or trigram
    // machinery involved at all.
    const exactMatches = await prisma.$queryRaw<IdRow[]>`
      SELECT id FROM "Memory"
      WHERE "bucketId" = ${memory.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND lower(content) = lower(${memory.content})
    `;
    if (exactMatches.length > 0) {
      for (const match of exactMatches) await createSuggestionIfNew(userId, memoryId, match.id);
      return;
    }

    // Tier 2 — fuzzy match: pg_trgm similarity, catching near-verbatim rewrites (punctuation,
    // casing, a typo) the exact tier's strict equality can't.
    const fuzzyMatches = await prisma.$queryRaw<IdRow[]>`
      SELECT id FROM "Memory"
      WHERE "bucketId" = ${memory.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND similarity(content, ${memory.content}) >= ${DUPLICATE_TRIGRAM_SIMILARITY_THRESHOLD}
    `;
    if (fuzzyMatches.length > 0) {
      for (const match of fuzzyMatches) await createSuggestionIfNew(userId, memoryId, match.id);
      return;
    }

    // Tier 3 — embedding threshold (unchanged): the fallback for pairs that read as different text
    // but mean the same thing, which only a semantic embedding can catch.
    const neighbors = await prisma.$queryRaw<NeighborRow[]>`
      SELECT id, (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) AS distance
      FROM "Memory"
      WHERE "bucketId" = ${memory.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT 5
    `;

    for (const neighbor of neighbors) {
      if (neighbor.distance > DUPLICATE_DISTANCE_THRESHOLD) continue;
      await createSuggestionIfNew(userId, memoryId, neighbor.id);
    }
  },
};
