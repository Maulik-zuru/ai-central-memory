import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { memoryService } from './memory.service';
import { createMemorySchema, listMemoriesSchema, mergeMemoriesSchema, updateMemorySchema } from './memory.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const memoryController = {
  async create(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { content } = createMemorySchema.parse(req.body);
    const memory = await memoryService.create(userId, content, 'manual');
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
    const memory = await memoryService.createImage(
      userId,
      { buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype },
      caption,
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
};
