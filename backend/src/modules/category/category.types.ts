import { z } from 'zod';

export const renameCategorySchema = z.object({
  label: z.string().trim().min(1).max(60),
});
