import { prisma } from '../../shared/prisma';
import { getJobRunner } from '../../shared/providers/job-runner.provider';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Nothing before this phase transitions a `trialing` subscription once trialEndsAt passes
// (docs/Phase10_Implementation_Plan.md §4) — a status transition, not a forced downgrade of
// `plan`: a user who never picks a plan simply reverts to what Core already allows.
export const trialExpiryService = {
  async runExpiry(): Promise<void> {
    await prisma.subscription.updateMany({
      where: { status: 'trialing', trialEndsAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
  },

  registerScheduledJob(): void {
    getJobRunner().schedule('trial-expiry', CHECK_INTERVAL_MS, trialExpiryService.runExpiry);
  },
};
