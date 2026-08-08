import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { requireBucketMembership, accessibleBucketIds } from '../../shared/bucketAccess';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { SUPPORTED_FILE_MIME_TYPES } from '../../shared/providers/document-parser.provider';
import { processingService } from './processing.service';

export const file_service = {
  async upload(
    userId: string,
    bucketId: string,
    input: { buffer: Buffer; filename: string; mimeType: string; sizeBytes: number },
  ) {
    await requireBucketMembership(userId, bucketId, 'editor');

    // Rejected before StorageProvider.put() is ever called (US-FIL-01's "rejected before upload
    // completes" AC) — the multer fileFilter in file.routes.ts is the first line of defense for
    // the browser case, this is the service-level re-check for any other caller (API key, etc.).
    if (!SUPPORTED_FILE_MIME_TYPES.includes(input.mimeType)) {
      throw AppError.badRequest(`Unsupported file type: ${input.mimeType}`, 'UNSUPPORTED_FILE_TYPE');
    }

    const stored = await getStorageProvider().put(input.buffer, input.filename);

    const file = await prisma.file.create({
      data: {
        bucketId,
        userId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: stored.key,
        status: 'processing',
      },
    });

    void processingService.process(file.id);

    return file;
  },

  async get(userId: string, id: string) {
    const file = await prisma.file.findUnique({ where: { id } });
    if (!file) throw AppError.notFound('File not found');
    await requireBucketMembership(userId, file.bucketId, 'viewer');
    return file;
  },

  async list(userId: string, opts: { cursor?: string; limit: number; bucketId?: string }) {
    const bucketIds = opts.bucketId
      ? [(await requireBucketMembership(userId, opts.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);

    const rows = await prisma.file.findMany({
      where: { bucketId: { in: bucketIds } },
      orderBy: { createdAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  },

  async remove(userId: string, id: string) {
    const file = await prisma.file.findUnique({ where: { id } });
    if (!file) throw AppError.notFound('File not found');
    await requireBucketMembership(userId, file.bucketId, 'editor');

    // Chunks cascade via the FK; the underlying bytes don't, so they're deleted explicitly — no
    // orphaned storage objects (same discipline image-memory deletion already established).
    await prisma.file.delete({ where: { id } });
    await getStorageProvider().delete(file.storageKey);
  },
};
