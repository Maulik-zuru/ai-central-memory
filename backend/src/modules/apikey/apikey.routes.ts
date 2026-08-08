import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requireScope } from '../../shared/requireScope';
import { apiKeyController } from './apikey.controller';

export const apiKeyRouter = Router();

apiKeyRouter.use(authenticate);
apiKeyRouter.use(apiRateLimit);
// A no-op for session auth; an extension-scoped (or any other minimally-scoped) API key
// specifically cannot mint further API keys for itself, even though a dashboard session still
// can exactly as before (Phase8_BrowserExtension_Implementation_Plan.md §5.3). Deliberately not
// applied to GET/DELETE: the extension's own "Disconnect" action reuses DELETE /:id to revoke the
// key it was paired with — self-revocation isn't the privilege escalation this scope guards
// against, minting *more* keys is.
apiKeyRouter.post('/', requireScope('apikey:manage'), asyncHandler(apiKeyController.create));
apiKeyRouter.get('/', asyncHandler(apiKeyController.list));
apiKeyRouter.delete('/:id', asyncHandler(apiKeyController.revoke));
