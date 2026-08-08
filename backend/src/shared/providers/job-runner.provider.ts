import { logger } from '../logger';

export interface JobRunner {
  /** Registers a handler to run every `intervalMs`. Fire-and-forget: callers don't await this. */
  schedule(name: string, intervalMs: number, handler: () => Promise<void>): void;
  /** Test/debug hook — run every registered job's handler once, immediately, awaited. */
  runAllNow(): Promise<void>;
  stop(): void;
}

// No real cron infra this phase (same call as Phase 2's job-queue decision and Phase 4's
// CacheProvider — see docs/Phase5_Implementation_Plan.md §4): a managed cron trigger or BullMQ
// repeatable job is a Phase 10/12 upgrade behind this same three-method interface. This
// in-process implementation is enough to prove "runs on a schedule, not just once" today.
class InProcessJobRunner implements JobRunner {
  private jobs: { name: string; handler: () => Promise<void>; timer: ReturnType<typeof setInterval> }[] = [];

  schedule(name: string, intervalMs: number, handler: () => Promise<void>): void {
    const timer = setInterval(() => {
      handler().catch((err) => logger.error({ err, job: name }, 'Scheduled job failed'));
    }, intervalMs);
    timer.unref?.();
    this.jobs.push({ name, handler, timer });
  }

  async runAllNow(): Promise<void> {
    for (const job of this.jobs) {
      await job.handler().catch((err) => logger.error({ err, job: job.name }, 'Scheduled job failed'));
    }
  }

  stop(): void {
    for (const job of this.jobs) clearInterval(job.timer);
    this.jobs = [];
  }
}

let cached: JobRunner | null = null;

export function getJobRunner(): JobRunner {
  if (!cached) cached = new InProcessJobRunner();
  return cached;
}

export function __resetJobRunnerForTests(): void {
  cached?.stop();
  cached = new InProcessJobRunner();
}
