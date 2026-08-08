import { z } from 'zod';

export const importSchema = z.object({
  bucketId: z.string().min(1),
  platform: z.string().min(1),
});

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  bucketId: z.string().min(1).optional(),
  mode: z.enum(['semantic', 'precise']).default('semantic'),
});

export const listConversationsSchema = z.object({
  bucketId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
