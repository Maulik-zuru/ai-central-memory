import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { optionalBucketRole } from '../../shared/bucketAccess';
import { requirePlan } from '../../shared/requirePlan';
import { chatHistoryController } from './chat-history.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const chatHistoryRouter = Router();

chatHistoryRouter.use(authenticate);
chatHistoryRouter.use(apiRateLimit);

chatHistoryRouter.post('/import', upload.single('file'), asyncHandler(chatHistoryController.import_));
chatHistoryRouter.get('/conversations', optionalBucketRole('viewer'), asyncHandler(chatHistoryController.list));
chatHistoryRouter.get('/conversations/:id', asyncHandler(chatHistoryController.transcript));
chatHistoryRouter.post('/search', optionalBucketRole('viewer'), asyncHandler(chatHistoryController.search));
chatHistoryRouter.get('/usage', asyncHandler(chatHistoryController.usage));
// Retrofit (docs/Phase10_Implementation_Plan.md §3): monthly insights are Pro-only.
chatHistoryRouter.get('/insights', requirePlan('pro'), asyncHandler(chatHistoryController.insights));
