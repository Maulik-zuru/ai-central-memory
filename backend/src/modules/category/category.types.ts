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

export const recategorizeSchema = z.object({
  bucketId: z.string().min(1),
});

// Deliberately permissive at the schema layer, same reasoning as account.types.ts's
// deleteAccountSchema: categoryService.reset() stays the single place the exact confirmation
// string is enforced.
export const resetCategoriesSchema = z.object({
  bucketId: z.string().min(1),
  confirmation: z.string().optional(),
});
