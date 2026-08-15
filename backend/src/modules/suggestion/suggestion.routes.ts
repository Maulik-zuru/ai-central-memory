import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { suggestionController } from './suggestion.controller';

export const suggestionRouter = Router();

suggestionRouter.use(authenticate);
suggestionRouter.use(apiRateLimit);
suggestionRouter.get('/', asyncHandler(suggestionController.list));
suggestionRouter.post('/scan', asyncHandler(suggestionController.scanBucket));
// Registered before the single-id routes below only by convention (Express matches these two
// literal, single-segment paths regardless of order — they can't collide with `/:id/approve`,
// which always has two segments).
suggestionRouter.post('/approve-many', asyncHandler(suggestionController.approveMany));
suggestionRouter.post('/dismiss-many', asyncHandler(suggestionController.dismissMany));
suggestionRouter.post('/:id/approve', asyncHandler(suggestionController.approve));
suggestionRouter.post('/:id/dismiss', asyncHandler(suggestionController.dismiss));
