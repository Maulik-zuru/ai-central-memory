import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { retrievalService } from './retrieval.service';
import { previewContextSchema } from './context.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const contextController = {
  async preview(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { snippet, bucketId, tokenBudget } = previewContextSchema.parse(req.body);
    const result = await retrievalService.buildContext(userId, { snippet, bucketId, tokenBudget });
    res.status(200).json(result);
  },
};
