import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { complianceService } from './compliance.service';

// US-ACC-05's AC: "link expires after a reasonable window." Seven days matches the trial/refund
// windows this codebase already uses as its unit of "a reasonable window for a human to act."
const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Assembles every category of the user's data (US-ACC-05: "not just a subset"). File *metadata*
 * rather than re-bundled bytes — the user already has the originals they uploaded, and inlining
 * every PDF would make the archive unusable for the far more common "what do you know about me"
 * reading of an export request. Embeddings are excluded deliberately: a 1536-float vector per row
 * is derived data that means nothing outside this system, and including it would bloat the archive
 * by orders of magnitude for no user-facing benefit.
 */
async function buildArchive(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
  if (!user) throw new Error(`Cannot export data for a user that no longer exists: ${userId}`);

  const [buckets, memories, conversations, files, askConversations, suggestions] = await Promise.all([
    prisma.bucket.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { importedAt: 'asc' },
      include: { messages: { orderBy: { position: 'asc' } } },
    }),
    prisma.file.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.askConversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { messages: { orderBy: { position: 'asc' } } },
    }),
    prisma.memorySuggestion.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      autoCapture: user.autoCapture,
      smartMemoryEnabled: user.smartMemoryEnabled,
      subscription: user.subscription
        ? { plan: user.subscription.plan, status: user.subscription.status, trialEndsAt: user.subscription.trialEndsAt }
        : null,
    },
    buckets,
    memories: memories.map((memory) => ({
      id: memory.id,
      bucketId: memory.bucketId,
      type: memory.type,
      content: memory.content,
      imageUrl: memory.imageUrl,
      source: memory.source,
      status: memory.status,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      versions: memory.versions,
    })),
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      bucketId: conversation.bucketId,
      platform: conversation.platform,
      title: conversation.title,
      summary: conversation.summary,
      importedAt: conversation.importedAt,
      messages: conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
        position: m.position,
        createdAt: m.createdAt,
      })),
    })),
    // Metadata only — see the note above buildArchive().
    files: files.map((file) => ({
      id: file.id,
      bucketId: file.bucketId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      pageCount: file.pageCount,
      status: file.status,
      createdAt: file.createdAt,
    })),
    askThreads: askConversations,
    suggestions,
  };
}

export const exportService = {
  /** Creates the tracking row and returns immediately — archive generation never blocks the
   * request, the same fire-and-forget shape memory.service.create()'s embedding chain uses. */
  async request(userId: string) {
    const row = await prisma.dataExportRequest.create({ data: { userId, status: 'queued' } });
    void exportService.runExport(row.id).catch((err) => {
      logger.error({ err, requestId: row.id }, 'Data export job failed outside its own error handling');
    });
    return row;
  },

  /** The job body. Every exit path leaves a terminal status — "running" is never a resting state
   * (US-SEC-03's AC: a failed export tells the user to retry rather than failing silently). */
  async runExport(requestId: string): Promise<void> {
    const row = await prisma.dataExportRequest.findUnique({ where: { id: requestId } });
    if (!row) return;

    const requestedAt = row.requestedAt;
    await prisma.dataExportRequest.updateMany({ where: { id: requestId }, data: { status: 'running' } });

    try {
      const archive = await buildArchive(row.userId);
      const stored = await getStorageProvider().put(
        Buffer.from(JSON.stringify(archive, null, 2)),
        `memoryos-export-${row.userId}.json`,
      );
      const completedAt = new Date();
      await prisma.dataExportRequest.updateMany({
        where: { id: requestId },
        data: {
          status: 'complete',
          downloadKey: stored.key,
          completedAt,
          expiresAt: new Date(completedAt.getTime() + EXPORT_TTL_MS),
          errorReason: null,
        },
      });
      await complianceService.record({
        userId: row.userId,
        email: archive.account.email,
        action: 'data.export',
        requestedAt,
        outcome: 'completed',
      });
    } catch (err) {
      logger.error({ err, requestId }, 'Data export failed');
      await prisma.dataExportRequest.updateMany({
        where: { id: requestId },
        data: { status: 'failed', errorReason: err instanceof Error ? err.message : 'Unknown error' },
      });
      await complianceService
        .record({ userId: row.userId, action: 'data.export', requestedAt, outcome: 'failed' })
        .catch(() => {
          // The user may no longer exist (that is one way an export fails) — a missing evidence
          // row for a failed export is acceptable; a stuck "running" row is not.
        });
    }
  },

  async list(userId: string) {
    return prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      select: {
        id: true,
        status: true,
        errorReason: true,
        requestedAt: true,
        completedAt: true,
        expiresAt: true,
      },
    });
  },

  /** Ownership is checked as a 404, not a 403: confirming "this export exists but isn't yours"
   * would leak that another account requested one. */
  async download(userId: string, requestId: string): Promise<Buffer> {
    const row = await prisma.dataExportRequest.findUnique({ where: { id: requestId } });
    if (!row || row.userId !== userId) throw AppError.notFound('Export not found');
    if (row.status !== 'complete' || !row.downloadKey) {
      throw AppError.badRequest('This export is not ready yet', 'EXPORT_NOT_READY');
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw AppError.forbidden('This export link has expired. Request a new export.', 'EXPORT_EXPIRED');
    }
    return getStorageProvider().get(row.downloadKey);
  },
};
