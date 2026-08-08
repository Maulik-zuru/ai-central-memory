import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { getJobRunner } from '../../shared/providers/job-runner.provider';
import { hasPlan } from '../../shared/requirePlan';

// US-ARC-06: a periodic digest, not on-demand only. A user with too little activity in the month
// gets an honest `summary: null` row rather than a fabricated digest (the AC this floor exists
// to satisfy) — chosen as "at least 1 conversation imported that month," a low bar deliberately,
// since the point is distinguishing "genuinely nothing happened" from "something did."
const MIN_CONVERSATIONS_FOR_INSIGHT = 1;
const MONTHLY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // JobRunner checks daily; only acts once per user per month (see §runForAllUsers)

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end };
}

export const insightService = {
  async generateForUser(userId: string, month: string): Promise<void> {
    // Retrofit (docs/Phase10_Implementation_Plan.md §3): Pro-only. Skipped, not errored — this
    // runs for every user in runForAllUsers()'s daily sweep regardless of plan.
    if (!(await hasPlan(userId, 'pro'))) return;

    const { start, end } = monthRange(month);
    const conversations = await prisma.conversation.findMany({
      where: { userId, importedAt: { gte: start, lt: end } },
      select: { title: true, summary: true },
    });

    if (conversations.length < MIN_CONVERSATIONS_FOR_INSIGHT) {
      await prisma.monthlyInsight.upsert({
        where: { userId_month: { userId, month } },
        update: { summary: null },
        create: { userId, month, summary: null },
      });
      return;
    }

    const digestInput = conversations.map((c) => `- ${c.title}: ${c.summary ?? '(no summary yet)'}`).join('\n');
    const summary = await getLlmProvider().summarize(
      `Conversations from this month:\n${digestInput}\n\nSummarize the key themes and patterns across these.`,
    );

    await prisma.monthlyInsight.upsert({
      where: { userId_month: { userId, month } },
      update: { summary },
      create: { userId, month, summary },
    });
  },

  async runForAllUsers(month: string): Promise<void> {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await this.generateForUser(user.id, month);
    }
  },

  /** Registers the monthly job with JobRunner — called once at app startup. */
  registerScheduledJob(): void {
    getJobRunner().schedule('monthly-insights', MONTHLY_CHECK_INTERVAL_MS, async () => {
      const previousMonth = new Date();
      previousMonth.setUTCDate(0); // last day of the previous month
      await insightService.runForAllUsers(monthKey(previousMonth));
    });
  },

  monthKey,
};
