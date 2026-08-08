import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requirePlan } from '../../shared/requirePlan';
import { categoryController } from './category.controller';

export const categoryRouter = Router();

categoryRouter.use(authenticate);
categoryRouter.use(apiRateLimit);
categoryRouter.get('/', asyncHandler(categoryController.list));
// Retrofit (docs/Phase10_Implementation_Plan.md §3): full category tuning (rename/management) is
// Pro; the basic on/off Smart Memory toggle (account.smart-memory) stays Core, untouched.
categoryRouter.patch('/:id', requirePlan('pro'), asyncHandler(categoryController.rename));
