import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { DUPLICATE_DISTANCE_THRESHOLD } from './duplicate-detection.service';

// Same-topic-but-different-value pairs (e.g. "I live in Berlin" vs "I now live in Lisbon") land in
// this band empirically — similar enough to be about the same fact, not similar enough to be the
// same statement. See duplicate-detection.service.ts for the calibration this shares.
export const STALE_DISTANCE_UPPER_BOUND = 0.55;

interface NeighborRow {
  id: string;
  content: string;
  distance: number;
  createdAt: Date;
}

// Phase 3 widening (docs/Phase3_Implementation_Plan.md §3.1): scoped by bucket, not creator — see
// duplicate-detection.service.ts's comment for the full rationale.
//
// Phase 18 (ADR-0003 "supersedes relation"): the distance band alone only tells you two memories
// are about the same topic at different values — it was never sufficient to tell a genuine
// contradiction ("moved to Lisbon" replacing "lives in Berlin") from a mere addition ("got a second
// phone number" extending it). classifyStaleness() makes that judgment call before a suggestion is
// created, so type is "replaces" or "extends" from the start, not an undifferentiated "stale".
export const staleDetectionService = {
  async run(userId: string, memoryId: string): Promise<void> {
    const current = await prisma.memory.findUnique({ where: { id: memoryId } });
    if (!current) return;

    const neighbors = await prisma.$queryRaw<NeighborRow[]>`
      SELECT id, content, "createdAt", (embedding <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) AS distance
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
      const older = neighbor.createdAt < current.createdAt ? neighbor : { id: memoryId, content: current.content };
      const newer = older.id === neighbor.id ? { id: memoryId, content: current.content } : neighbor;

      const existing = await prisma.memorySuggestion.findFirst({
        where: { type: { in: ['replaces', 'extends'] }, memoryIdA: older.id, memoryIdB: newer.id },
      });
      if (existing) continue;

      const classification = await getLlmProvider().classifyStaleness(older.content, newer.content);
      await prisma.memorySuggestion.create({
        data: { userId, type: classification, memoryIdA: older.id, memoryIdB: newer.id },
      });
    }
  },
};
