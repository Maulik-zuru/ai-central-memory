import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { optionalBucketRole } from '../../shared/bucketAccess';
import { askController } from './ask.controller';

export const askRouter = Router();

askRouter.use(authenticate);
askRouter.use(apiRateLimit);

askRouter.post('/', optionalBucketRole('viewer'), asyncHandler(askController.ask));
askRouter.get('/threads', asyncHandler(askController.listThreads));
askRouter.get('/threads/:id', asyncHandler(askController.getThread));
