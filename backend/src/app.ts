import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './shared/env';
import { errorHandler, notFoundHandler } from './shared/errorHandler';
import { apiRateLimit } from './shared/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { apiKeyRouter } from './modules/apikey/apikey.routes';
import { accountRouter } from './modules/account/account.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter);
  app.use('/api/keys', apiRateLimit, apiKeyRouter);
  app.use('/api/account', apiRateLimit, accountRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
