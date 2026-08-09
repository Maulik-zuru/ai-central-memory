import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { paymentsEnabled } from '../../shared/entitlements';

export const accountService = {
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) throw AppError.notFound('Account not found');

    return {
      id: user.id,
      email: user.email,
      hasPassword: Boolean(user.passwordHash),
      googleLinked: Boolean(user.oauthGoogleId),
      createdAt: user.createdAt,
      autoCapture: user.autoCapture as Record<string, boolean>,
      smartMemoryEnabled: user.smartMemoryEnabled,
      hasSeenTour: user.hasSeenTour,
      // Drives whether the dashboard renders any billing surface at all. Sent from the server
      // rather than read from a NEXT_PUBLIC_ env var so the two can never disagree — the server
      // is what actually enforces the gates.
      paymentsEnabled: paymentsEnabled(),
      // On a free deployment every account reports as fully entitled with no trial, because that
      // is what it is — not a 'core' account that happens to bypass every check.
      subscription: paymentsEnabled()
        ? user.subscription
          ? {
              plan: user.subscription.plan,
              status: user.subscription.status,
              trialEndsAt: user.subscription.trialEndsAt,
            }
          : null
        : { plan: 'pro', status: 'active', trialEndsAt: null },
    };
  },

  async updateAutoCapture(userId: string, autoCapture: Record<string, boolean>) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { autoCapture },
    });
    await auditService.record(userId, 'account.autoCapture.update', { type: 'User', id: userId });
    return user.autoCapture as Record<string, boolean>;
  },

  /** Phase 12: one-way flag — the first-run tour is dismissed once and never re-shown. */
  async markTourSeen(userId: string) {
    const user = await prisma.user.update({ where: { id: userId }, data: { hasSeenTour: true } });
    return user.hasSeenTour;
  },

  async updateSmartMemory(userId: string, enabled: boolean) {
    const user = await prisma.user.update({ where: { id: userId }, data: { smartMemoryEnabled: enabled } });
    await auditService.record(userId, 'account.smartMemory.update', { type: 'User', id: userId });
    return user.smartMemoryEnabled;
  },
};
