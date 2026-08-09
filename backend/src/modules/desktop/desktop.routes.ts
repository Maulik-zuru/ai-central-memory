import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit, pairingRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { desktopController } from './desktop.controller';

export const desktopRouter = Router();

// start/status are deliberately unauthenticated (the agent has no user yet) and IP rate-limited
// instead — identical to the extension's pairing routes.
desktopRouter.post('/pairing/start', pairingRateLimit, asyncHandler(desktopController.start));
desktopRouter.get('/pairing/status', pairingRateLimit, asyncHandler(desktopController.status));

desktopRouter.use(authenticate);
desktopRouter.use(apiRateLimit);

// The one dashboard-session-authenticated step: US-INT-07's "explicit, visible authorization".
desktopRouter.post('/pairing/claim', asyncHandler(desktopController.claim));
desktopRouter.get('/devices', asyncHandler(desktopController.list));
desktopRouter.delete('/devices/:id', asyncHandler(desktopController.revoke));
desktopRouter.post('/heartbeat', asyncHandler(desktopController.heartbeat));
