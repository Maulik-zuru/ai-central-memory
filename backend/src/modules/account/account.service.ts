import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';

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
      subscription: user.subscription
        ? {
            plan: user.subscription.plan,
            status: user.subscription.status,
            trialEndsAt: user.subscription.trialEndsAt,
          }
        : null,
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
};
