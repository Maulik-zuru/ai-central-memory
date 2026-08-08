import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { file_service } from './file.service';
import { ragService } from './rag.service';
import { fileSearchService } from './file-search.service';
import { askFileSchema, fileSearchSchema, listFilesSchema, uploadFileSchema } from './file.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const fileController = {
  async upload(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const file = req.file;
    if (!file) throw AppError.badRequest('A file is required', 'MISSING_FILE');
    const { bucketId } = uploadFileSchema.parse(req.body);
    const created = await file_service.upload(userId, bucketId, {
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
    res.status(201).json({ file: created });
  },

  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId, cursor, limit } = listFilesSchema.parse(req.query);
    const page = await file_service.list(userId, { bucketId, cursor, limit: limit ?? 20 });
    res.status(200).json(page);
  },

  async get(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const file = await file_service.get(userId, req.params.id);
    res.status(200).json({ file });
  },

  async remove(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    await file_service.remove(userId, req.params.id);
    res.status(204).send();
  },

  async ask(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { question } = askFileSchema.parse(req.body);
    const result = await ragService.answer(userId, req.params.id, question);
    res.status(200).json(result);
  },

  async search(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { query, bucketId } = fileSearchSchema.parse(req.body);
    const results = await fileSearchService.search(userId, { query, bucketId });
    res.status(200).json({ results });
  },
};
