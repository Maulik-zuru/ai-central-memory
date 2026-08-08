import { z } from 'zod';

export const uploadFileSchema = z.object({
  bucketId: z.string().min(1),
});

export const askFileSchema = z.object({
  question: z.string().trim().min(1).max(2000),
});

export const fileSearchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  bucketId: z.string().min(1).optional(),
});

export const listFilesSchema = z.object({
  bucketId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
