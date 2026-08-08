import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { billingService } from './billing.service';
import { checkoutSchema } from './billing.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const billingController = {
  async checkout(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { plan } = checkoutSchema.parse(req.body);
    const session = await billingService.createCheckoutSession(userId, plan);
    res.status(200).json(session);
  },

  async portal(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const session = await billingService.createBillingPortalSession(userId);
    res.status(200).json(session);
  },

  // Unauthenticated by design (docs/Phase10_Implementation_Plan.md §5.3) — verified by Stripe's
  // signature header, not a session/API key. A thrown error here must reach the client as a
  // non-2xx response so Stripe retries — asyncHandler's catch(next) already does that; this
  // handler must not itself swallow a failure into a 200.
  async webhook(req: Request, res: Response) {
    await billingService.handleWebhook(JSON.stringify(req.body), req.header('stripe-signature'));
    res.status(200).json({ received: true });
  },

  async summary(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const summary = await billingService.getUsageAndBilling(userId);
    res.status(200).json(summary);
  },
};
