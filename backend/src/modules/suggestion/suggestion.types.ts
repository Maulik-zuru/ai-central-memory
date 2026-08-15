import { z } from 'zod';

export const scanBucketSchema = z.object({
  bucketId: z.string().min(1),
});

// Same array-of-ids shape as chat-history's deleteMany/excludeMany (chat-history.types.ts) — one
// bad id in a batch shouldn't block the rest, so this is validated as a plain array, not an
// all-or-nothing operation.
export const bulkSuggestionIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});
