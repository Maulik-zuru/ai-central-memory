import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from '../../shared/errors';
import { asyncHandler } from '../../shared/errorHandler';
import { logger } from '../../shared/logger';
import { healthService } from './health.service';
import { rechunkService } from '../chat-history/rechunk.service';

/**
 * Internal operator surface, not a customer one. Three deliberate properties:
 *
 *  - It is gated by a dedicated OPS_API_KEY, never by `authenticate` — a normal user session or a
 *    customer API key must not reach it. Failure rates and job backlogs are useful reconnaissance
 *    to an attacker and useless to a legitimate end user.
 *  - With no OPS_API_KEY configured the router isn't mounted at all, so it 404s rather than
 *    existing in a default-open state. Local development and CI get no ops endpoint, by default.
 *  - The key comparison is timing-safe, for the same reason api-key auth hashes before comparing.
 */
function requireOpsKey(req: Request, _res: Response, next: NextFunction) {
  const configured = process.env.OPS_API_KEY;
  if (!configured) throw AppError.notFound('Route not found');

  const presented = req.header('x-ops-key') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw AppError.unauthorized('Invalid ops key', 'INVALID_OPS_KEY');
  }
  return next();
}

export const opsRouter = Router();

opsRouter.get(
  '/health',
  requireOpsKey,
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json(await healthService.snapshot());
  }),
);

// Phase 17 (US-ARC-07): the token-based re-chunk migration's operator trigger — "run once,
// dry-run against a copy first" (?dryRun=true reports the backlog and writes nothing). A real run
// is fire-and-forget: the backlog can span every message ever imported, so this returns
// immediately rather than holding one HTTP request open for however long that takes — poll
// ?dryRun=true afterward to watch messagesRemaining fall to 0.
opsRouter.post(
  '/rechunk-message-chunks',
  requireOpsKey,
  asyncHandler(async (req: Request, res: Response) => {
    if (req.query.dryRun === 'true') {
      return res.status(200).json({ dryRun: true, ...(await rechunkService.dryRun()) });
    }
    void rechunkService.run().catch((err) => logger.error({ err }, 'Message re-chunk migration failed'));
    res.status(202).json({ started: true });
  }),
);
