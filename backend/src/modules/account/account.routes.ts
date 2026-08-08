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
accountRouter.get('/sessions', asyncHandler(accountController.listSessions));
accountRouter.delete('/sessions/:id', asyncHandler(accountController.revokeSession));
