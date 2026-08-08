import { prisma } from '../../shared/prisma';
import { DUPLICATE_DISTANCE_THRESHOLD } from './duplicate-detection.service';

// Same-topic-but-different-value pairs (e.g. "I live in Berlin" vs "I now live in Lisbon") land in
// this band empirically — similar enough to be about the same fact, not similar enough to be the
// same statement. See duplicate-detection.service.ts for the calibration this shares.
export const STALE_DISTANCE_UPPER_BOUND = 0.55;

interface NeighborRow {
  id: string;
  distance: number;
  createdAt: Date;
}

// Phase 3 widening (docs/Phase3_Implementation_Plan.md §3.1): scoped by bucket, not creator — see
// duplicate-detection.service.ts's comment for the full rationale.
export const staleDetectionService = {
  async run(userId: string, memoryId: string): Promise<void> {
    const current = await prisma.memory.findUnique({ where: { id: memoryId } });
    if (!current) return;

    const neighbors = await prisma.$queryRaw<NeighborRow[]>`
      SELECT id, "createdAt", (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) AS distance
      FROM "Memory"
      WHERE "bucketId" = ${current.bucketId}
        AND status = 'active'
        AND id != ${memoryId}
        AND embedding IS NOT NULL
        AND (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) > ${DUPLICATE_DISTANCE_THRESHOLD}
        AND (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) <= ${STALE_DISTANCE_UPPER_BOUND}
      ORDER BY distance ASC
      LIMIT 5
    `;

    for (const neighbor of neighbors) {
      // Flag whichever of the pair is older — US-MEM-07: a newer contradicting memory flags the
      // older one, never the other way around.
      const olderId = neighbor.createdAt < current.createdAt ? neighbor.id : memoryId;
      const newerId = olderId === neighbor.id ? memoryId : neighbor.id;

      const existing = await prisma.memorySuggestion.findFirst({
        where: { type: 'stale', memoryIdA: olderId, memoryIdB: newerId },
      });
      if (existing) continue;

      await prisma.memorySuggestion.create({
        data: { userId, type: 'stale', memoryIdA: olderId, memoryIdB: newerId },
      });
    }
  },
};
