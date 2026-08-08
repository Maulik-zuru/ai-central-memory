import { createApp } from './app';
import { env } from './shared/env';
import { logger } from './shared/logger';
import { prisma } from './shared/prisma';
import { insightService } from './modules/chat-history/insight.service';

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`AI Memory backend listening on port ${env.port}`);
});

// Phase 5's monthly-insights digest (US-ARC-06) — registered once at process startup, not
// per-request. See job-runner.provider.ts for why this is an in-process interval rather than
// real cron infra this phase.
insightService.registerScheduledJob();

// Without this, a deploy/restart kills in-flight requests and leaves Postgres connections open
// until they time out — SIGTERM is what container orchestrators (Docker, Kubernetes, etc.) send
// on every rolling deploy, not just on crash (nodejs-backend-patterns: graceful shutdown).
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error while closing HTTP server');
      process.exitCode = 1;
    }
    await prisma.$disconnect();
    process.exit();
  });

  // Belt-and-suspenders: force-exit if connections don't drain in time.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
