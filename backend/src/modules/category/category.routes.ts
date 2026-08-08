import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { categoryController } from './category.controller';

export const categoryRouter = Router();

categoryRouter.use(authenticate);
categoryRouter.use(apiRateLimit);
categoryRouter.get('/', asyncHandler(categoryController.list));
categoryRouter.patch('/:id', asyncHandler(categoryController.rename));
