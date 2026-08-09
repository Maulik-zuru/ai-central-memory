import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { capFor } from '../../shared/entitlements';

// US-ARC-08: enforced server-side, not just suggested in the UI. Core plan caps at 500
// conversations; Pro is unlimited. Counted by importer (Conversation.userId), the same field
// Memory.userId/File.userId already use for "who did this," while access itself is still governed
// by bucket membership, not this count.
//
// The cap is resolved through entitlements.capFor() rather than read from Subscription here, so a
// deployment running with PAYMENTS_ENABLED=false gets `null` (unlimited) without this module
// needing to know the flag exists.
export const CORE_HISTORY_LIMIT = 500;

export const historyLimitService = {
  async assertWithinLimit(userId: string): Promise<void> {
    const limit = await capFor(userId, CORE_HISTORY_LIMIT);
    if (limit === null) return;

    const count = await prisma.conversation.count({ where: { userId } });
    if (count >= limit) {
      throw AppError.forbidden(
        `You've reached the Core plan's ${limit}-conversation limit. Upgrade to Pro for unlimited history.`,
        'HISTORY_LIMIT_REACHED',
      );
    }
  },

  async usage(userId: string): Promise<{ count: number; limit: number | null }> {
    const [limit, count] = await Promise.all([
      capFor(userId, CORE_HISTORY_LIMIT),
      prisma.conversation.count({ where: { userId } }),
    ]);
    return { count, limit };
  },
};
