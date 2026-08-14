import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { capFor } from '../../shared/entitlements';

// US-ARC-08: enforced server-side, not just suggested in the UI. Core plan caps at 500
// *searchable conversations from a single platform on a single account* — not one pool shared
// across every connected platform (MemoryPlugin_Clone_Spec.md §3.3; see
// MemoryPlugin_Gap_Analysis.md §2.4 for why the previous global-count version undercounted a
// multi-platform user's actual quota). Pro is unlimited, across every platform. Counted by
// importer (Conversation.userId) scoped to the platform being imported into, the same field
// Memory.userId/File.userId already use for "who did this," while access itself is still governed
// by bucket membership, not this count.
//
// The cap is resolved through entitlements.capFor() rather than read from Subscription here, so a
// deployment running with PAYMENTS_ENABLED=false gets `null` (unlimited) without this module
// needing to know the flag exists.
export const CORE_HISTORY_LIMIT = 500;

export const historyLimitService = {
  async assertWithinLimit(userId: string, platform: string): Promise<void> {
    const limit = await capFor(userId, CORE_HISTORY_LIMIT);
    if (limit === null) return;

    const count = await prisma.conversation.count({ where: { userId, platform } });
    if (count >= limit) {
      throw AppError.forbidden(
        `You've reached the Core plan's ${limit}-conversation limit for ${platform}. Upgrade to Pro for unlimited history.`,
        'HISTORY_LIMIT_REACHED',
      );
    }
  },

  /** Per-platform usage — the account-wide total this used to return conflated every connected
   * platform's quota into one number, which made "approaching the limit" meaningless for anyone
   * with more than one platform imported. */
  async usage(userId: string): Promise<{ limit: number | null; platforms: { platform: string; count: number }[] }> {
    const [limit, rows] = await Promise.all([
      capFor(userId, CORE_HISTORY_LIMIT),
      prisma.conversation.groupBy({ by: ['platform'], where: { userId }, _count: { _all: true } }),
    ]);
    return {
      limit,
      platforms: rows.map((r) => ({ platform: r.platform, count: r._count._all })),
    };
  },
};
