import { Router } from 'express';
import { Request, Response } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { AppError } from '../../shared/errors';
import { captureSchema } from './memory.types';
import { captureService } from './capture.service';

async function submit(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const { snippet, platform } = captureSchema.parse(req.body);
  // Phase 18 (§7.4): fire-and-forget — the extraction LLM call no longer sits inline, so there's
  // no suggestion list to hand back yet. The caller polls `GET /api/suggestions` for the result.
  await captureService.submit(req.auth.userId, snippet, platform);
  res.status(202).json({ status: 'queued' });
}

export const captureRouter = Router();
captureRouter.use(authenticate);
captureRouter.use(apiRateLimit);
captureRouter.post('/', asyncHandler(submit));
