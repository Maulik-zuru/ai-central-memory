import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './shared/env';
import { errorHandler, notFoundHandler } from './shared/errorHandler';
import { logger } from './shared/logger';
import { prisma } from './shared/prisma';
import { apiRateLimit } from './shared/rateLimit';
import { UPLOAD_DIR } from './shared/providers/storage.provider';
import { authRouter } from './modules/auth/auth.routes';
import { apiKeyRouter } from './modules/apikey/apikey.routes';
import { accountRouter } from './modules/account/account.routes';
import { memoryRouter } from './modules/memory/memory.routes';
import { suggestionRouter } from './modules/suggestion/suggestion.routes';
import { captureRouter } from './modules/memory/capture.routes';

export function createApp() {
  const app = express();

  // Behind a load balancer / reverse proxy in every real deployment — without this, req.ip and
  // the rate limiter both key off the proxy's address instead of the real client (Backend_Plan.md
  // Phase 12 infra assumption, needed from Phase 1 since rate limiting already ships this phase).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    }),
  );

  // 100kb comfortably covers auth/account/api-key payloads; a real upload surface (Files, Phase 6)
  // gets its own dedicated limit rather than raising this one globally.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'error', database: 'down' });
    }
  });

  // Local-disk image memories (StorageProvider — see docs/Phase2_Implementation_Plan.md §3).
  app.use('/uploads', express.static(UPLOAD_DIR));

  app.use('/api/auth', authRouter);
  app.use('/api/keys', apiRateLimit, apiKeyRouter);
  app.use('/api/account', apiRateLimit, accountRouter);
  app.use('/api/memories', apiRateLimit, memoryRouter);
  app.use('/api/suggestions', apiRateLimit, suggestionRouter);
  app.use('/api/capture', apiRateLimit, captureRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
