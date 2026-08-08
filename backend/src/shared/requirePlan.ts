import { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma';
import { AppError } from './errors';
import { asyncHandler } from './errorHandler';

export type Plan = 'pro';

// The one place Pro-gating logic lives (docs/Phase10_Implementation_Plan.md §4) — mirrors
// requireScope's shape exactly: a no-op when the check passes, a clear 403 with a specific code
// when it doesn't. Unlike requireScope, this checks a property of the *account*
// (Subscription.plan), not of how this particular request authenticated — it applies the same way
// to a session and an API key.
export async function hasPlan(userId: string, plan: Plan): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  return subscription?.plan === plan;
}

export async function assertPlan(userId: string, plan: Plan): Promise<void> {
  if (!(await hasPlan(userId, plan))) {
    throw AppError.forbidden(
      'This feature is available on the Pro plan. Upgrade to unlock it.',
      'PRO_FEATURE',
    );
  }
}

export function requirePlan(plan: Plan) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw AppError.unauthorized();
    await assertPlan(req.auth.userId, plan);
    next();
  });
}
