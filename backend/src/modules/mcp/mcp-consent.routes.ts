import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { asyncHandler } from '../../shared/errorHandler';
import { mcpConsentController } from './mcp-consent.controller';

// Authenticated via this app's normal session/API-key `authenticate` — deliberately not the SDK's
// bearer-auth (see mcp-bearer.ts's comment): this is the dashboard user approving a *new*
// connection, before any MCP access token exists to authenticate with.
export const mcpConsentRouter = Router();

mcpConsentRouter.use(authenticate);
mcpConsentRouter.get('/:requestId', asyncHandler(mcpConsentController.describe));
mcpConsentRouter.post('/:requestId/approve', asyncHandler(mcpConsentController.approve));
mcpConsentRouter.post('/:requestId/deny', asyncHandler(mcpConsentController.deny));
