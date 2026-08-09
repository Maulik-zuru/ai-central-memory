import { prisma } from './prisma';
import { env } from './env';

export type Plan = 'pro';

/**
 * The one place the product decides what an account is entitled to.
 *
 * Every plan gate, usage cap, and Pro-only batch job in the codebase asks this module rather than
 * querying `Subscription.plan` itself. That is the whole point: with `PAYMENTS_ENABLED=false` the
 * product is free, and "free" has to mean free *everywhere* — a single gate that kept its own copy
 * of the check would silently keep charging for one feature after the flag was flipped.
 *
 * When payments are disabled, `isEntitled()` returns true for every account and every cap returns
 * "unlimited". No subscription row is even read: entitlement stops being a property of the account
 * and becomes a property of the deployment.
 */

/** Whether this deployment sells anything at all. */
export function paymentsEnabled(): boolean {
  return env.paymentsEnabled;
}

/**
 * Is this account entitled to `plan`-tier features?
 *
 * Always true when payments are disabled. Otherwise reads the real subscription.
 */
export async function isEntitled(userId: string, plan: Plan = 'pro'): Promise<boolean> {
  if (!paymentsEnabled()) return true;
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  return subscription?.plan === plan;
}

/**
 * Resolve a usage cap. Returns `null` for "unlimited".
 *
 * Callers pass the Core-tier cap; entitled accounts and free deployments both get `null`, so a
 * call site never has to branch on the flag itself.
 */
export async function capFor(userId: string, coreLimit: number): Promise<number | null> {
  return (await isEntitled(userId)) ? null : coreLimit;
}

/**
 * The set of accounts a Pro-only background job should process.
 *
 * Returns every user when payments are disabled — otherwise a free deployment would run the
 * knowledge-graph extractor for nobody, and the feature would appear broken rather than free.
 */
export async function entitledUserIds(): Promise<string[]> {
  const where = paymentsEnabled() ? { subscription: { plan: 'pro' } } : {};
  const users = await prisma.user.findMany({ where, select: { id: true } });
  return users.map((u) => u.id);
}

/** Message shown when a gate actually blocks someone. Only reachable with payments enabled. */
export const UPGRADE_MESSAGE = 'This feature is available on the Pro plan. Upgrade to unlock it.';
