import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { complianceService } from './compliance.service';

// US-ACC-06's AC: "explicit confirmation (typed confirmation or equivalent friction, not a single
// accidental click)". Enforced here, server-side, so the friction is real rather than a client-side
// dialog anyone calling the API directly could skip.
const REQUIRED_CONFIRMATION = 'DELETE';

/** Memory.imageUrl is stored as the public path ("/uploads/<key>"); the storage provider is keyed
 * by <key>. File.storageKey is already the raw key. */
function keyFromImageUrl(imageUrl: string): string {
  return imageUrl.replace(/^\/uploads\//, '');
}

async function collectStorageKeys(userId: string): Promise<string[]> {
  const [imageMemories, files] = await Promise.all([
    prisma.memory.findMany({
      where: { userId, imageUrl: { not: null } },
      select: { imageUrl: true },
    }),
    prisma.file.findMany({ where: { userId }, select: { storageKey: true } }),
  ]);

  return [
    ...imageMemories.map((m) => keyFromImageUrl(m.imageUrl!)),
    ...files.map((f) => f.storageKey),
  ];
}

export const accountDeletionService = {
  /**
   * Order matters and is the whole design (docs/Phase11_Implementation_Plan.md §5.2):
   *
   *   1. storage keys are collected *before* anything is deleted — once the DB rows are gone,
   *      nothing knows which objects belonged to this user, and they'd be orphaned forever;
   *   2. the ComplianceLog row is written *before* the delete, while the User row still exists to
   *      snapshot an email from;
   *   3. the storage objects are removed *before* the DB cascade, so a failure here aborts with
   *      the database still intact and the operation safely retryable — the reverse order would
   *      leave unreferenced blobs no future run could ever find;
   *   4. prisma.user.delete() then cascades every Postgres row (sessions, buckets, memories,
   *      conversations, subscription, analytics, payments...) in one statement.
   */
  async deleteAccount(userId: string, confirmation: unknown): Promise<void> {
    if (confirmation !== REQUIRED_CONFIRMATION) {
      throw AppError.badRequest(
        `Type ${REQUIRED_CONFIRMATION} to confirm permanent deletion of your account and all its data.`,
        'CONFIRMATION_REQUIRED',
      );
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw AppError.notFound('Account not found');

    const requestedAt = new Date();
    const storageKeys = await collectStorageKeys(userId);

    await complianceService.record({
      userId,
      email: user.email,
      action: 'account.delete',
      requestedAt,
      outcome: 'completed',
    });

    const storage = getStorageProvider();
    try {
      for (const key of storageKeys) {
        await storage.delete(key);
      }
    } catch (err) {
      logger.error({ err, userId }, 'Account deletion aborted: storage cleanup failed');
      // Leave the database untouched so the whole operation can be retried cleanly. A
      // partially-deleted account (rows gone, blobs orphaned) is unrecoverable; a failed one is not.
      throw AppError.badRequest(
        'Deletion could not complete because stored files could not be removed. Nothing was deleted — please try again.',
        'DELETION_FAILED',
      );
    }

    await prisma.user.delete({ where: { id: userId } });
    logger.info({ userId, objectsRemoved: storageKeys.length }, 'Account permanently deleted');
  },

  /** Powers the UI's "here is exactly what will be deleted" disclosure (US-ACC-06's AC: the user
   * is told what will be deleted *before* confirming), counted from real rows rather than a
   * hardcoded list that could drift from what the cascade actually removes. */
  async deletionPreview(userId: string) {
    const [memories, buckets, conversations, files, apiKeys, askThreads] = await Promise.all([
      prisma.memory.count({ where: { userId } }),
      prisma.bucket.count({ where: { userId } }),
      prisma.conversation.count({ where: { userId } }),
      prisma.file.count({ where: { userId } }),
      prisma.apiKey.count({ where: { userId, revokedAt: null } }),
      prisma.askConversation.count({ where: { userId } }),
    ]);
    return { memories, buckets, conversations, files, apiKeys, askThreads };
  },
};
