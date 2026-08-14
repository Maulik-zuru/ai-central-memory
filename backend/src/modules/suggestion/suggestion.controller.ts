import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { suggestionService } from './suggestion.service';
import { scanBucketSchema } from './suggestion.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const suggestionController = {
  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const suggestions = await suggestionService.listPending(userId);
    res.status(200).json({ suggestions });
  },

  async approve(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const suggestion = await suggestionService.approve(userId, req.params.id);
    res.status(200).json({ suggestion });
  },

  async dismiss(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const suggestion = await suggestionService.dismiss(userId, req.params.id);
    res.status(200).json({ suggestion });
  },

  async scanBucket(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId } = scanBucketSchema.parse(req.body);
    const result = await suggestionService.scanBucket(userId, bucketId);
    res.status(200).json(result);
  },
};
