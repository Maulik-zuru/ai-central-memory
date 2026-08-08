import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { asyncHandler } from '../../shared/errorHandler';
import { suggestionController } from './suggestion.controller';

export const suggestionRouter = Router();

suggestionRouter.use(authenticate);
suggestionRouter.get('/', asyncHandler(suggestionController.list));
suggestionRouter.post('/:id/approve', asyncHandler(suggestionController.approve));
suggestionRouter.post('/:id/dismiss', asyncHandler(suggestionController.dismiss));
