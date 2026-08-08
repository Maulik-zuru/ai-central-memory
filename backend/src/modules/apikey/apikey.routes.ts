import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { asyncHandler } from '../../shared/errorHandler';
import { apiKeyController } from './apikey.controller';

export const apiKeyRouter = Router();

apiKeyRouter.use(authenticate);
apiKeyRouter.post('/', asyncHandler(apiKeyController.create));
apiKeyRouter.get('/', asyncHandler(apiKeyController.list));
apiKeyRouter.delete('/:id', asyncHandler(apiKeyController.revoke));
