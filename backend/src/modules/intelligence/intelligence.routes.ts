import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requirePlan } from '../../shared/requirePlan';
import { intelligenceController } from './intelligence.controller';

export const intelligenceRouter = Router();

intelligenceRouter.use(authenticate);
intelligenceRouter.use(apiRateLimit);
intelligenceRouter.use(requirePlan('pro'));

intelligenceRouter.get('/graph', asyncHandler(intelligenceController.graph));
intelligenceRouter.get('/usage', asyncHandler(intelligenceController.usage));
intelligenceRouter.get('/insights', asyncHandler(intelligenceController.insights));
