import { Router } from 'express';
import { Request, Response } from 'express';
import { authenticate } from '../../shared/authenticate';
import { asyncHandler } from '../../shared/errorHandler';
import { AppError } from '../../shared/errors';
import { captureSchema } from './memory.types';
import { captureService } from './capture.service';

async function submit(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const { snippet } = captureSchema.parse(req.body);
  const suggestions = await captureService.submit(req.auth.userId, snippet);
  res.status(201).json({ suggestions });
}

export const captureRouter = Router();
captureRouter.use(authenticate);
captureRouter.post('/', asyncHandler(submit));
