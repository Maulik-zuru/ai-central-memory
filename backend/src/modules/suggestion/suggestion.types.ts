import { z } from 'zod';

export const scanBucketSchema = z.object({
  bucketId: z.string().min(1),
});
