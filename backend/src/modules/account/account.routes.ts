import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { asyncHandler } from '../../shared/errorHandler';
import { accountController } from './account.controller';

export const accountRouter = Router();

accountRouter.use(authenticate);
accountRouter.get('/me', asyncHandler(accountController.me));
accountRouter.patch('/auto-capture', asyncHandler(accountController.updateAutoCapture));
accountRouter.get('/sessions', asyncHandler(accountController.listSessions));
accountRouter.delete('/sessions/:id', asyncHandler(accountController.revokeSession));
