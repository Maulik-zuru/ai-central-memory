import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { categoryService } from './category.service';
import {
  listCategoriesQuerySchema,
  listCategoryMemoriesQuerySchema,
  recategorizeSchema,
  renameCategorySchema,
  resetCategoriesSchema,
} from './category.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const categoryController = {
  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId } = listCategoriesQuerySchema.parse(req.query);
    const categories = await categoryService.list(userId, bucketId);
    res.status(200).json({ categories });
  },

  // Phase 16: the full memory list within one category — no existing endpoint covered this; net-new
  // per docs/MemoryPlugin_Parity_Implementation_Plan.md Phase 16 §2, shared with the
  // `memoryos_list_category_memories` MCP tool via categoryService.listMemories().
  async listMemories(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const query = listCategoryMemoriesQuerySchema.parse(req.query);
    const result = await categoryService.listMemories(userId, req.params.id, query);
    res.status(200).json(result);
  },

  async rename(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { label } = renameCategorySchema.parse(req.body);
    const category = await categoryService.rename(userId, req.params.id, label);
    res.status(200).json({ category });
  },

  // Phase 20: MemoryPlugin_Clone_Spec.md §5.1's batch categorization job, owner-triggered per bucket.
  async recategorize(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId } = recategorizeSchema.parse(req.body);
    const result = await categoryService.recategorize(userId, bucketId);
    res.status(200).json(result);
  },

  // Phase 20: destructive, confirmation-phrase-gated (categoryService.reset enforces the phrase).
  async reset(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId, confirmation } = resetCategoriesSchema.parse(req.body);
    await categoryService.reset(userId, bucketId, confirmation);
    res.status(204).send();
  },
};
