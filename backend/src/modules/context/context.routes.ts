import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { optionalBucketRole } from '../../shared/bucketAccess';
import { contextController } from './context.controller';

export const contextRouter = Router();

contextRouter.use(authenticate);
contextRouter.use(apiRateLimit);
// Bucket-scoped when bucketId is given (Phase 3's requireBucketRole, not a parallel check);
// omitted means "every bucket the caller can see" (Phase4_Implementation_Plan.md §3).
contextRouter.post('/preview', optionalBucketRole('viewer'), asyncHandler(contextController.preview));
