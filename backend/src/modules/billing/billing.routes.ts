import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requirePaymentsEnabled } from '../../shared/requirePlan';
import { billingController } from './billing.controller';

export const billingRouter = Router();

// Unauthenticated: Stripe calls this directly, verified by signature (see billing.controller.ts).
// Registered before the authenticate/apiRateLimit middleware below applies to the rest of the router.
// 404s when payments are off — a deployment that sells nothing should not accept payment webhooks.
billingRouter.post('/webhook', requirePaymentsEnabled(), asyncHandler(billingController.webhook));

billingRouter.use(authenticate);
billingRouter.use(apiRateLimit);

// Checkout and the customer portal genuinely do not exist on a free deployment — 404, rather than
// a checkout session for a product that isn't for sale.
billingRouter.post('/checkout', requirePaymentsEnabled(), asyncHandler(billingController.checkout));
billingRouter.post('/portal', requirePaymentsEnabled(), asyncHandler(billingController.portal));

// Summary stays available either way: it is how the frontend learns whether to render any billing
// UI at all, and it still reports real usage numbers on a free deployment.
billingRouter.get('/summary', asyncHandler(billingController.summary));
