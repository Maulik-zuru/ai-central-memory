import { prisma } from '../../shared/prisma';

// A memory whose embedding hasn't landed within this window means the fire-and-forget chain in
// embedding.service.ts died rather than merely being in flight — embedding a single row takes
// milliseconds with a real provider, so ten minutes is generous by orders of magnitude.
const EMBEDDING_STALE_AFTER_MS = 10 * 60 * 1000;

export interface SyncHealth {
  windowHours: number;
  total: number;
  failed: number;
  /** 0 when nothing synced in the window — deliberately not NaN, which would break any alert
   * threshold comparing against it. */
  rate: number;
}

export interface EmbeddingHealth {
  stale: number;
  oldestAgeSeconds: number | null;
}

// Deliberately built on state this codebase already records (Conversation.status, the nullable
// Memory.embedding column) rather than a parallel metrics pipeline every future phase would then
// have to remember to also update — see docs/Phase12_Implementation_Plan.md §9.
export const healthService = {
  async syncFailureRate(windowHours: number): Promise<SyncHealth> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [total, failed] = await Promise.all([
      prisma.conversation.count({ where: { importedAt: { gte: since } } }),
      prisma.conversation.count({ where: { importedAt: { gte: since }, status: 'error' } }),
    ]);
    return { windowHours, total, failed, rate: total === 0 ? 0 : failed / total };
  },

  async embeddingBacklog(): Promise<EmbeddingHealth> {
    const cutoff = new Date(Date.now() - EMBEDDING_STALE_AFTER_MS);
    // Memory.embedding is Unsupported("vector") and therefore not queryable through the Prisma
    // client — the same reason every other embedding read in this codebase drops to raw SQL.
    const rows = await prisma.$queryRaw<{ stale: bigint; oldest: Date | null }[]>`
      SELECT COUNT(*) AS stale, MIN("createdAt") AS oldest
      FROM "Memory"
      WHERE embedding IS NULL AND status <> 'deleted' AND "createdAt" < ${cutoff}
    `;
    const row = rows[0];
    return {
      stale: Number(row?.stale ?? 0),
      oldestAgeSeconds: row?.oldest ? Math.round((Date.now() - row.oldest.getTime()) / 1000) : null,
    };
  },

  /** Proves the process can actually reach Postgres, rather than only that it is running. */
  async databaseReachable(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  },

  async snapshot() {
    const [sync, embeddings, database] = await Promise.all([
      healthService.syncFailureRate(24),
      healthService.embeddingBacklog(),
      healthService.databaseReachable(),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      database: database ? 'ok' : 'unreachable',
      sync,
      embeddings,
    };
  },
};
