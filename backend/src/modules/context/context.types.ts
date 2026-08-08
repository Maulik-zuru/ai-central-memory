import { z } from 'zod';

export const previewContextSchema = z.object({
  snippet: z.string().trim().min(1).max(4000),
  bucketId: z.string().min(1).optional(),
  tokenBudget: z.number().int().positive().max(20000).optional(),
});
