import { Request, Response } from 'express';
import { apiKeyService } from './apikey.service';
import { createApiKeySchema } from './apikey.types';
import { AppError } from '../../shared/errors';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const apiKeyController = {
  async create(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { name, scopes } = createApiKeySchema.parse(req.body);
    const key = await apiKeyService.issue(userId, name, scopes);
    res.status(201).json({ apiKey: key });
  },

  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const keys = await apiKeyService.list(userId);
    res.status(200).json({ apiKeys: keys });
  },

  async revoke(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const key = await apiKeyService.revoke(userId, req.params.id);
    res.status(200).json({ apiKey: key });
  },
};
