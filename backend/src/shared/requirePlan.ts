import { NextFunction, Request, Response } from 'express';
import { AppError } from './errors';
import { asyncHandler } from './errorHandler';
import { UPGRADE_MESSAGE, isEntitled, paymentsEnabled, type Plan } from './entitlements';

export type { Plan };

/**
 * Route middleware for Pro-only endpoints, and its service-level counterpart.
 *
 * Both delegate to entitlements.isEntitled(), which returns true for everyone when
 * `PAYMENTS_ENABLED` is off — so a free deployment passes every gate without any call site
 * needing to know the flag exists.
 *
 * Unlike requireScope (which only constrains API keys), this checks a property of the *account*,
 * so it applies identically to a session and an API key.
 */
export async function hasPlan(userId: string, plan: Plan = 'pro'): Promise<boolean> {
  return isEntitled(userId, plan);
}

export async function assertPlan(userId: string, plan: Plan = 'pro'): Promise<void> {
  if (!(await isEntitled(userId, plan))) {
    throw AppError.forbidden(UPGRADE_MESSAGE, 'PRO_FEATURE');
  }
}

export function requirePlan(plan: Plan) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw AppError.unauthorized();
    await assertPlan(req.auth.userId, plan);
    next();
  });
}

/**
 * Guards the billing surface itself. With payments disabled there is nothing to sell, so checkout
 * and the customer portal 404 rather than returning a broken checkout session — the endpoint
 * genuinely does not exist in this deployment.
 */
export function requirePaymentsEnabled() {
  return asyncHandler(async (_req: Request, _res: Response, next: NextFunction) => {
    if (!paymentsEnabled()) throw AppError.notFound('Route not found');
    next();
  });
}
