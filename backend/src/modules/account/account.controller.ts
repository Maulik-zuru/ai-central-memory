import { Request, Response } from 'express';
import { accountService } from './account.service';
import { updateAutoCaptureSchema } from './account.types';
import { sessionService } from '../session/session.service';
import { AppError } from '../../shared/errors';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const accountController = {
  async me(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const account = await accountService.getMe(userId);
    res.status(200).json({ account });
  },

  async updateAutoCapture(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { autoCapture } = updateAutoCaptureSchema.parse(req.body);
    const updated = await accountService.updateAutoCapture(userId, autoCapture);
    res.status(200).json({ autoCapture: updated });
  },

  async listSessions(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const sessions = await sessionService.list(userId);
    res.status(200).json({ sessions });
  },

  async revokeSession(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    await sessionService.revoke(userId, req.params.id);
    res.status(204).send();
  },
};
