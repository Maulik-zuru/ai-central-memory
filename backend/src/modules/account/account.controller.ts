import { Request, Response } from 'express';
import { accountService } from './account.service';
import { deleteAccountSchema, updateAutoCaptureSchema, updateSmartMemorySchema } from './account.types';
import { sessionService } from '../session/session.service';
import { exportService } from '../compliance/export.service';
import { accountDeletionService } from '../compliance/account-deletion.service';
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

  async updateSmartMemory(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { enabled } = updateSmartMemorySchema.parse(req.body);
    const smartMemoryEnabled = await accountService.updateSmartMemory(userId, enabled);
    res.status(200).json({ smartMemoryEnabled });
  },

  async markTourSeen(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const hasSeenTour = await accountService.markTourSeen(userId);
    res.status(200).json({ hasSeenTour });
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

  async revokeOtherSessions(req: Request, res: Response) {
    const auth = requireAuth(req);
    const revokedCount = await sessionService.revokeAllOthers(auth.userId, auth.sessionId);
    res.status(200).json({ revokedCount });
  },

  async requestExport(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const exportRequest = await exportService.request(userId);
    // 202, not 200: the archive is still being built when this returns (US-SEC-03's whole point
    // is that the status is trackable afterwards rather than the request blocking on the work).
    res.status(202).json({ export: exportRequest });
  },

  async listExports(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const exports = await exportService.list(userId);
    res.status(200).json({ exports });
  },

  async downloadExport(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const archive = await exportService.download(userId, req.params.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="memoryos-export-${req.params.id}.json"`);
    res.status(200).send(archive);
  },

  async deletionPreview(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const preview = await accountDeletionService.deletionPreview(userId);
    res.status(200).json({ preview });
  },

  async deleteAccount(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { confirmation } = deleteAccountSchema.parse(req.body);
    await accountDeletionService.deleteAccount(userId, confirmation);
    // The Session rows are gone with the cascade, but the browser still holds the httpOnly
    // refresh cookie. Left in place it keeps the client's optimistic "looks signed in" check
    // true and bounces the user back into a dashboard for an account that no longer exists.
    res.clearCookie('refreshToken', { path: '/' });
    res.status(200).json({ deleted: true });
  },
};
