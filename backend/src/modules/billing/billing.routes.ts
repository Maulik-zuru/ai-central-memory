import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { billingController } from './billing.controller';

export const billingRouter = Router();

// Unauthenticated: Stripe calls this directly, verified by signature (see billing.controller.ts).
// Registered before the authenticate/apiRateLimit middleware below applies to the rest of the router.
billingRouter.post('/webhook', asyncHandler(billingController.webhook));

billingRouter.use(authenticate);
billingRouter.use(apiRateLimit);

billingRouter.post('/checkout', asyncHandler(billingController.checkout));
billingRouter.post('/portal', asyncHandler(billingController.portal));
billingRouter.get('/summary', asyncHandler(billingController.summary));
