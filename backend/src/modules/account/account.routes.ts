import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { accountController } from './account.controller';

export const accountRouter = Router();

accountRouter.use(authenticate);
accountRouter.use(apiRateLimit);
accountRouter.get('/me', asyncHandler(accountController.me));
accountRouter.patch('/auto-capture', asyncHandler(accountController.updateAutoCapture));
accountRouter.patch('/smart-memory', asyncHandler(accountController.updateSmartMemory));
accountRouter.post('/tour-seen', asyncHandler(accountController.markTourSeen));
accountRouter.get('/sessions', asyncHandler(accountController.listSessions));
// Registered before the :id route so "revoke-others" is never parsed as a session id.
accountRouter.post('/sessions/revoke-others', asyncHandler(accountController.revokeOtherSessions));
accountRouter.delete('/sessions/:id', asyncHandler(accountController.revokeSession));

// Phase 11 — data export and permanent deletion (docs/Phase11_Implementation_Plan.md §5.3).
accountRouter.post('/export', asyncHandler(accountController.requestExport));
accountRouter.get('/export', asyncHandler(accountController.listExports));
accountRouter.get('/export/:id/download', asyncHandler(accountController.downloadExport));
accountRouter.get('/deletion-preview', asyncHandler(accountController.deletionPreview));
accountRouter.delete('/', asyncHandler(accountController.deleteAccount));
