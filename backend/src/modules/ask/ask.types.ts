import { z } from 'zod';

export const askSchema = z.object({
  conversationId: z.string().min(1).optional(),
  question: z.string().trim().min(1).max(2000),
  mode: z.enum(['memories', 'chat_history', 'files', 'all']).default('all'),
  bucketId: z.string().min(1).optional(),
});

export const listThreadsSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
