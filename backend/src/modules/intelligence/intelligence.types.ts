import { z } from 'zod';

export const graphQuerySchema = z.object({
  bucketId: z.string().min(1).optional(),
});

export const usageQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const insightsQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
