import { Router } from 'express';
import { Request, Response } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { AppError } from '../../shared/errors';
import { membershipService } from './membership.service';

async function accept(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const membership = await membershipService.acceptInvite(req.params.token, req.auth.userId);
  res.status(200).json({ membership });
}

export const inviteRouter = Router();
inviteRouter.use(authenticate);
inviteRouter.use(apiRateLimit);
inviteRouter.post('/:token/accept', asyncHandler(accept));
