import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';
import { curatorService } from './curator.service';

// No real job queue this phase (see docs/Phase2_Implementation_Plan.md §3 — Redis/BullMQ is a
// documented prerequisite, not yet wired up). This still satisfies the actual behavioral
// requirement — "queued automatically, not blocking the save" — as a fire-and-forget async chain:
// the caller never awaits process(), so the HTTP response returns before this runs. A real queue
// would swap the caller's `void embeddingService.process(...)` for `queue.add(...)` with no other
// changes, since this function's signature is already job-shaped (one memory, no return value).
//
// Phase 20 (ADR-0006) retired the incremental per-memory categorization call that used to run here
// — Smart Memory categorization is now an explicit, owner-triggered batch job over a whole bucket
// (categorization-batch.service.ts), not a side effect of every embed.
export const embeddingService = {
  async process(memoryId: string, userId: string, content: string): Promise<void> {
    try {
      const provider = getLlmProvider();
      const embedding = await provider.embed(content);
      await prisma.$executeRaw`
        UPDATE "Memory" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${memoryId}
      `;
      await curatorService.run(userId, memoryId);
    } catch (err) {
      logger.error({ err, memoryId }, 'Embedding pipeline failed');
    }
  },
};
