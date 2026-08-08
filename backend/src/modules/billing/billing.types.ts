import { z } from 'zod';

export const checkoutSchema = z.object({
  plan: z.literal('pro'),
});
