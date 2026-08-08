import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';

// US-ARC-08: enforced server-side, not just suggested in the UI. Core plan caps at 500
// conversations; Pro is unlimited. Counted by importer (Conversation.userId), the same field
// Memory.userId/File.userId already use for "who did this," while access itself is still governed
// by bucket membership, not this count.
export const CORE_HISTORY_LIMIT = 500;

export const historyLimitService = {
  async assertWithinLimit(userId: string): Promise<void> {
    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    if (subscription?.plan === 'pro') return;

    const count = await prisma.conversation.count({ where: { userId } });
    if (count >= CORE_HISTORY_LIMIT) {
      throw AppError.forbidden(
        `You've reached the Core plan's ${CORE_HISTORY_LIMIT}-conversation limit. Upgrade to Pro for unlimited history.`,
        'HISTORY_LIMIT_REACHED',
      );
    }
  },

  async usage(userId: string): Promise<{ count: number; limit: number | null }> {
    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    const count = await prisma.conversation.count({ where: { userId } });
    return { count, limit: subscription?.plan === 'pro' ? null : CORE_HISTORY_LIMIT };
  },
};
