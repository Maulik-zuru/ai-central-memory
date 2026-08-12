import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { mcpConsentService } from './mcp-consent.service';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const mcpConsentController = {
  async describe(req: Request, res: Response) {
    requireAuth(req);
    const info = await mcpConsentService.describe(req.params.requestId);
    res.status(200).json(info);
  },

  async approve(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const result = await mcpConsentService.approve(userId, req.params.requestId);
    res.status(200).json(result);
  },

  async deny(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const result = await mcpConsentService.deny(userId, req.params.requestId);
    res.status(200).json(result);
  },
};
