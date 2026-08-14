import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';
import { curatorService } from './curator.service';
import { categorizationService } from './categorization.service';

// No real job queue this phase (see docs/Phase2_Implementation_Plan.md §3 — Redis/BullMQ is a
// documented prerequisite, not yet wired up). This still satisfies the actual behavioral
// requirement — "queued automatically, not blocking the save" — as a fire-and-forget async chain:
// the caller never awaits process(), so the HTTP response returns before this runs. A real queue
// would swap the caller's `void embeddingService.process(...)` for `queue.add(...)` with no other
// changes, since this function's signature is already job-shaped (one memory, no return value).
export const embeddingService = {
  async process(memoryId: string, userId: string, content: string): Promise<void> {
    try {
      const provider = getLlmProvider();
      const embedding = await provider.embed(content);
      await prisma.$executeRaw`
        UPDATE "Memory" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${memoryId}
      `;
      await curatorService.run(userId, memoryId);
      await categorizationService.run(userId, memoryId);
    } catch (err) {
      logger.error({ err, memoryId }, 'Embedding pipeline failed');
    }
  },
};
