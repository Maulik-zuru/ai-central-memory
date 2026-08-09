import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { desktopPairingService, desktopService } from './desktop.service';
import { claimSchema, heartbeatSchema, statusQuerySchema } from './desktop.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

// Pairing and device revocation must only ever be authorized by an interactive session, never by
// another API key — a key can't authorize minting another key, and a compromised agent key must
// not be able to un-revoke or re-pair itself. Same rule as the extension's claim
// (docs/Phase13_DesktopAgent_Implementation_Plan.md §6.3).
function requireSession(req: Request) {
  const auth = requireAuth(req);
  if (auth.via !== 'session') {
    throw AppError.forbidden('This action requires a logged-in session', 'SESSION_REQUIRED');
  }
  return auth;
}

export const desktopController = {
  async start(_req: Request, res: Response) {
    const result = await desktopPairingService.start();
    res.status(201).json(result);
  },

  async status(req: Request, res: Response) {
    const { code } = statusQuerySchema.parse(req.query);
    res.status(200).json(await desktopPairingService.status(code));
  },

  async claim(req: Request, res: Response) {
    const { userId } = requireSession(req);
    const input = claimSchema.parse(req.body);
    res.status(200).json(await desktopService.claim(userId, input));
  },

  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    res.status(200).json({ devices: await desktopService.list(userId) });
  },

  async revoke(req: Request, res: Response) {
    const { userId } = requireSession(req);
    res.status(200).json({ device: await desktopService.revoke(userId, req.params.id) });
  },

  async heartbeat(req: Request, res: Response) {
    const auth = requireAuth(req);
    if (auth.via !== 'apiKey' || !auth.apiKeyId) {
      throw AppError.forbidden('Heartbeat is for paired devices only', 'DEVICE_KEY_REQUIRED');
    }
    const input = heartbeatSchema.parse(req.body);
    res.status(200).json({ device: await desktopService.heartbeat(auth.apiKeyId, input) });
  },
};
