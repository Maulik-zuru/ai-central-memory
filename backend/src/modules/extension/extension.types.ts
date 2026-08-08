import { z } from 'zod';

export const claimSchema = z.object({
  code: z.string().min(1),
});

export const statusQuerySchema = z.object({
  code: z.string().min(1),
});
