import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { memoryService } from './memory.service';
import { bucketService } from '../bucket/bucket.service';
import {
  bulkDeleteMemoriesSchema,
  createMemorySchema,
  listMemoriesSchema,
  mergeMemoriesSchema,
  updateMemorySchema,
  v2MemoryQuerySchema,
  v2MemoryUpdateSchema,
} from './memory.types';
import { moveMemorySchema } from '../bucket/bucket.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const memoryController = {
  async create(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { content, bucketId } = createMemorySchema.parse(req.body);
    const memory = await memoryService.create(userId, content, 'manual', bucketId);
    res.status(201).json({ memory });
  },

  async oneClickSave(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { content } = createMemorySchema.parse(req.body);
    const memory = await memoryService.oneClickSave(userId, content);
    res.status(201).json({ memory });
  },

  async createImage(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const file = req.file;
    if (!file) throw AppError.badRequest('An image file is required', 'MISSING_FILE');
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : undefined;
    const bucketId = typeof req.body?.bucketId === 'string' ? req.body.bucketId : undefined;
    const memory = await memoryService.createImage(
      userId,
      { buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype },
      caption,
      bucketId,
    );
    res.status(201).json({ memory });
  },

  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const query = listMemoriesSchema.parse(req.query);
    const page = await memoryService.list(userId, query);
    res.status(200).json(page);
  },

  async get(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const memory = await memoryService.get(userId, req.params.id);
    res.status(200).json({ memory });
  },

  async update(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { content } = updateMemorySchema.parse(req.body);
    const memory = await memoryService.update(userId, req.params.id, content);
    res.status(200).json({ memory });
  },

  async remove(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    await memoryService.delete(userId, req.params.id);
    res.status(204).send();
  },

  async move(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId } = moveMemorySchema.parse(req.body);
    const memory = await memoryService.move(userId, req.params.id, bucketId);
    res.status(200).json({ memory });
  },

  async merge(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { keepId, mergeId } = mergeMemoriesSchema.parse(req.body);
    const memory = await memoryService.merge(userId, keepId, mergeId);
    res.status(200).json({ memory });
  },

  async listVersions(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const versions = await memoryService.listVersions(userId, req.params.id);
    res.status(200).json({ versions });
  },

  async bulkDelete(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { memoryIds } = bulkDeleteMemoriesSchema.parse(req.body);
    const result = await memoryService.bulkDelete(userId, memoryIds);
    res.status(200).json(result);
  },

  // --- v2: MemoryPlugin_Clone_Spec.md §6 ("GET /api/v2/memory", "POST /api/v2/memory/update") ---

  /** Memories and buckets in one call — the spec's own justification for this endpoint existing
   * alongside plain `GET /api/memories` is fewer round trips for an integration that always needs
   * both, not a replacement for it. */
  async v2Query(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const query = v2MemoryQuerySchema.parse(req.query);
    const [page, buckets] = await Promise.all([
      memoryService.list(userId, { cursor: query.cursor, limit: query.limit, bucketId: query.bucketId, type: query.contentType }),
      bucketService.list(userId),
    ]);
    res.status(200).json({ memories: page.items, nextCursor: page.nextCursor, buckets });
  },

  /** Single-memory edit/move and bulk move, unified into one endpoint per the spec — see
   * `v2MemoryUpdateSchema`'s comment for why this is a discriminated union rather than two routes. */
  async v2Update(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const body = v2MemoryUpdateSchema.parse(req.body);

    if ('memoryId' in body) {
      let memory = await memoryService.get(userId, body.memoryId);
      if (body.text !== undefined) {
        memory = await memoryService.update(userId, body.memoryId, body.text);
      }
      if (body.bucketId || body.bucketName) {
        const targetBucketId = await memoryService.resolveBucketId(userId, {
          bucketId: body.bucketId,
          bucketName: body.bucketName,
        });
        memory = await memoryService.move(userId, body.memoryId, targetBucketId);
      }
      res.status(200).json({ memory });
      return;
    }

    const result = await memoryService.bulkMove(userId, body.memoryIds, {
      bucketId: body.bucketId,
      bucketName: body.bucketName,
    });
    res.status(200).json(result);
  },
};
