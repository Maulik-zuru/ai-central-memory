import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { categoryService } from './category.service';
import { renameCategorySchema } from './category.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const categoryController = {
  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const categories = await categoryService.list(userId);
    res.status(200).json({ categories });
  },

  async rename(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { label } = renameCategorySchema.parse(req.body);
    const category = await categoryService.rename(userId, req.params.id, label);
    res.status(200).json({ category });
  },
};
