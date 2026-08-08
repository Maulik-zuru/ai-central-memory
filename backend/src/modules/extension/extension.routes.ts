import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { pairingRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { extensionController } from './extension.controller';

export const extensionRouter = Router();

// start/status are deliberately unauthenticated (the extension has no user yet) and IP
// rate-limited instead — see shared/rateLimit.ts's pairingRateLimit.
extensionRouter.post('/pairing/start', pairingRateLimit, asyncHandler(extensionController.start));
extensionRouter.get('/pairing/status', pairingRateLimit, asyncHandler(extensionController.status));

// claim is the one dashboard-session-authenticated step in the flow.
extensionRouter.post('/pairing/claim', authenticate, asyncHandler(extensionController.claim));
