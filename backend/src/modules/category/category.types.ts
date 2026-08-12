import { z } from 'zod';

export const renameCategorySchema = z.object({
  label: z.string().trim().min(1).max(60),
});

export const listCategoriesQuerySchema = z.object({
  bucketId: z.string().optional(),
});

export const listCategoryMemoriesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
