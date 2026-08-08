import { prisma } from '../../shared/prisma';

// Cosine distance from pgvector's `<=>` operator: 0 = identical, 2 = opposite. This resolves the
// open question flagged in Product_Requirements.md §10 ("the exact similarity threshold... needs
// a concrete first value") — calibrated empirically against the stub embedding provider (see
// docs/Phase2_Implementation_Plan.md §5.2): near-identical text lands under 0.15, paraphrases and
// same-topic-different-value pairs land in the 0.15–0.55 band (handled by stale-detection),
// unrelated text lands well above that.
export const DUPLICATE_DISTANCE_THRESHOLD = 0.15;

interface NeighborRow {
  id: string;
  distance: number;
}

// Phase 3 widening (docs/Phase3_Implementation_Plan.md §3.1): candidates are scoped by bucket,
// not by creator — two different collaborators contributing near-identical facts to the same
// shared bucket must be flagged against each other, not just against their own other memories.
// `userId` is still recorded on the suggestion (who/what triggered it), but membership — not this
// field — governs who can see or act on it (suggestion.service.ts).
export const duplicateDetectionService = {
  async run(userId: string, memoryId: string): Promise<void> {
    const memory = await prisma.memory.findUnique({ where: { id: memoryId }, select: { bucketId: true } });
    if (!memory) return;

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

      const [memoryIdA, memoryIdB] = [memoryId, neighbor.id].sort();

      // A prior suggestion for this exact pair — pending, approved, or dismissed — means it's
      // already been surfaced once. Dismissing must permanently silence the pair (US-MEM-06 AC).
      const existing = await prisma.memorySuggestion.findFirst({
        where: { type: 'duplicate', memoryIdA, memoryIdB },
      });
      if (existing) continue;

      await prisma.memorySuggestion.create({
        data: { userId, type: 'duplicate', memoryIdA, memoryIdB },
      });
    }
  },
};
