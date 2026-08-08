import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { extensionPairingService } from './extension-pairing.service';
import { claimSchema, statusQuerySchema } from './extension.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const extensionController = {
  async start(_req: Request, res: Response) {
    const result = await extensionPairingService.start();
    res.status(201).json(result);
  },

  async claim(req: Request, res: Response) {
    const { userId, via } = requireAuth(req);
    // Pairing must only ever be authorized by an interactive session, never by another API
    // key — a key can't authorize minting another key (Phase8_BrowserExtension_Implementation_Plan.md §5.2).
    if (via !== 'session') throw AppError.forbidden('Pairing can only be claimed from a logged-in session', 'SESSION_REQUIRED');
    const { code } = claimSchema.parse(req.body);
    const result = await extensionPairingService.claim(userId, code);
    res.status(200).json(result);
  },

  async status(req: Request, res: Response) {
    const { code } = statusQuerySchema.parse(req.query);
    const result = await extensionPairingService.status(code);
    res.status(200).json(result);
  },
};
