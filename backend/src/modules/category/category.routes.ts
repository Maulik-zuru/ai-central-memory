import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requirePlan } from '../../shared/requirePlan';
import { requireBucketRole } from '../../shared/bucketAccess';
import { categoryController } from './category.controller';

export const categoryRouter = Router();

categoryRouter.use(authenticate);
categoryRouter.use(apiRateLimit);
categoryRouter.get('/', asyncHandler(categoryController.list));
categoryRouter.get('/:id/memories', asyncHandler(categoryController.listMemories));
// Retrofit (docs/Phase10_Implementation_Plan.md §3): full category tuning (rename/management) is
// Pro; the basic on/off Smart Memory toggle (account.smart-memory) stays Core, untouched.
categoryRouter.patch('/:id', requirePlan('pro'), asyncHandler(categoryController.rename));
// Phase 20 (MemoryPlugin_Clone_Spec.md §3.2): owner-only, both routes — requireBucketRole('owner')
// resolves bucketId from the body (see bucketAccess.ts's resolveBucketId), matching every other
// bucket-scoped route's convention; categoryService re-checks membership itself regardless
// (services stay self-defending, per bucket.service.ts's own comment on the same discipline).
categoryRouter.post('/recategorize', requireBucketRole('owner'), asyncHandler(categoryController.recategorize));
categoryRouter.post('/reset', requireBucketRole('owner'), asyncHandler(categoryController.reset));
