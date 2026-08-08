import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getJobRunner } from '../../shared/providers/job-runner.provider';

export type UsageEventType = 'memory_created' | 'ask_query' | 'sync_completed' | 'context_preview';

const DAILY_ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(period: string): { start: Date; end: Date } {
  const [year, mon] = period.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end };
}

export interface UsageSummary {
  period: string;
  memoriesCreated: number;
  askQueries: number;
  syncsCompleted: number;
  tokensSaved: number;
  computedAt: Date;
}

export const analyticsService = {
  /** A one-line fire-and-forget insert at each real action site — never awaited on the request's
   * critical path (docs/Phase9_Implementation_Plan.md §5.2). */
  record(userId: string, type: UsageEventType, metadata?: Record<string, unknown>): void {
    prisma.usageAnalyticsEvent
      .create({ data: { userId, type, metadata: metadata as object | undefined } })
      .catch((err) => logger.error({ err, userId, type }, 'Failed to record usage analytics event'));
  },

  async rollupForUser(userId: string, period: string): Promise<void> {
    const { start, end } = monthRange(period);
    const events = await prisma.usageAnalyticsEvent.findMany({
      where: { userId, createdAt: { gte: start, lt: end } },
    });

    const memoriesCreated = events.filter((e) => e.type === 'memory_created').length;
    const askQueries = events.filter((e) => e.type === 'ask_query').length;
    const syncsCompleted = events.filter((e) => e.type === 'sync_completed').length;
    const tokensSaved = events
      .filter((e) => e.type === 'context_preview')
      .reduce((sum, e) => sum + ((e.metadata as { tokensSaved?: number } | null)?.tokensSaved ?? 0), 0);

    await prisma.usageAnalyticsSummary.upsert({
      where: { userId_period: { userId, period } },
      update: { memoriesCreated, askQueries, syncsCompleted, tokensSaved, computedAt: new Date() },
      create: { userId, period, memoriesCreated, askQueries, syncsCompleted, tokensSaved },
    });
  },

  async runMonthlyRollup(): Promise<void> {
    const users = await prisma.user.findMany({ select: { id: true } });
    const period = monthKey(new Date());
    for (const user of users) {
      await analyticsService.rollupForUser(user.id, period);
    }
  },

  async getUsage(userId: string, period?: string): Promise<UsageSummary | null> {
    const targetPeriod = period ?? monthKey(new Date());
    const summary = await prisma.usageAnalyticsSummary.findUnique({
      where: { userId_period: { userId, period: targetPeriod } },
    });
    if (!summary) return null;
    return {
      period: summary.period,
      memoriesCreated: summary.memoriesCreated,
      askQueries: summary.askQueries,
      syncsCompleted: summary.syncsCompleted,
      tokensSaved: summary.tokensSaved,
      computedAt: summary.computedAt,
    };
  },

  /** Registers the daily rollup job with JobRunner — called once at process startup. */
  registerScheduledJob(): void {
    getJobRunner().schedule('usage-analytics-rollup', DAILY_ROLLUP_INTERVAL_MS, analyticsService.runMonthlyRollup);
  },

  monthKey,
};
