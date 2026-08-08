import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { askService } from './ask.service';
import { askSchema, listThreadsSchema } from './ask.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const askController = {
  async ask(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { conversationId, question, mode, bucketId } = askSchema.parse(req.body);
    const result = await askService.ask(userId, { conversationId, question, mode, bucketId });
    res.status(200).json(result);
  },

  async listThreads(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { cursor, limit } = listThreadsSchema.parse(req.query);
    const page = await askService.listThreads(userId, { cursor, limit: limit ?? 20 });
    res.status(200).json(page);
  },

  async getThread(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const conversation = await askService.getThread(userId, req.params.id);
    res.status(200).json({ conversation });
  },
};
