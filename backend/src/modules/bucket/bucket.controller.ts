import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { bucketService } from './bucket.service';
import { createBucketSchema, renameBucketSchema, moveBucketSchema, deleteBucketSchema } from './bucket.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const bucketController = {
  async create(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { name, parentId, type } = createBucketSchema.parse(req.body);
    const bucket = await bucketService.create(userId, name, parentId, type);
    res.status(201).json({ bucket });
  },

  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const buckets = await bucketService.list(userId);
    res.status(200).json({ buckets });
  },

  async update(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const bucketId = req.params.bucketId;

    if (typeof req.body?.name === 'string') {
      const { name } = renameBucketSchema.parse(req.body);
      const bucket = await bucketService.rename(userId, bucketId, name);
      res.status(200).json({ bucket });
      return;
    }

    const { parentId } = moveBucketSchema.parse(req.body);
    const bucket = await bucketService.move(userId, bucketId, parentId);
    res.status(200).json({ bucket });
  },

  async remove(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { strategy } = deleteBucketSchema.parse(req.body ?? {});
    await bucketService.delete(userId, req.params.bucketId, strategy);
    res.status(204).send();
  },
};
