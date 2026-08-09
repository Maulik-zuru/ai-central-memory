import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requireScope, requireSessionAuth } from '../../shared/requireScope';
import { accountController } from './account.controller';

export const accountRouter = Router();

accountRouter.use(authenticate);
accountRouter.use(apiRateLimit);

// Ungated: the browser extension legitimately reads the account and toggles capture consent with
// its narrowly-scoped key (extension/src/background/api.ts).
accountRouter.get('/me', asyncHandler(accountController.me));
accountRouter.patch('/auto-capture', asyncHandler(accountController.updateAutoCapture));
accountRouter.patch('/smart-memory', asyncHandler(accountController.updateSmartMemory));
accountRouter.post('/tour-seen', asyncHandler(accountController.markTourSeen));
accountRouter.get('/sessions', asyncHandler(accountController.listSessions));
accountRouter.delete('/sessions/:id', asyncHandler(accountController.revokeSession));

// Everything below is either an exfiltration surface (a full account dump) or a destructive one,
// and none of it has a legitimate API-key caller. `requireScope` is a no-op for dashboard
// sessions, so gating costs the UI nothing; what it stops is a leaked or malicious extension key
// — issued with only memory/context/bucket/suggestion scopes — using the account router to walk
// off with, or destroy, the whole account.
// Registered before the :id route so "revoke-others" is never parsed as a session id.
accountRouter.post(
  '/sessions/revoke-others',
  requireScope('account:manage'),
  asyncHandler(accountController.revokeOtherSessions),
);

// Phase 11 — data export and permanent deletion (docs/Phase11_Implementation_Plan.md §5.3).
accountRouter.post('/export', requireScope('account:manage'), asyncHandler(accountController.requestExport));
accountRouter.get('/export', requireScope('account:manage'), asyncHandler(accountController.listExports));
accountRouter.get(
  '/export/:id/download',
  requireScope('account:manage'),
  asyncHandler(accountController.downloadExport),
);
accountRouter.get(
  '/deletion-preview',
  requireScope('account:manage'),
  asyncHandler(accountController.deletionPreview),
);
// Session-only, not merely scoped: permanent, unrecoverable destruction should not be reachable
// by any credential a user can hand to a third-party client.
accountRouter.delete('/', requireSessionAuth(), asyncHandler(accountController.deleteAccount));
