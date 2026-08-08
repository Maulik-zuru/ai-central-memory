import { z } from 'zod';

export const createMemorySchema = z.object({
  content: z.string().trim().min(1, 'Memory content is required').max(4000),
  bucketId: z.string().optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().trim().min(1, 'Memory content is required').max(4000),
});

export const listMemoriesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  bucketId: z.string().optional(),
});

export const mergeMemoriesSchema = z.object({
  keepId: z.string().min(1),
  mergeId: z.string().min(1),
});

export const captureSchema = z.object({
  snippet: z.string().trim().min(1).max(8000),
  // Phase 11 (US-ACC-07): which platform the snippet came from, so the per-platform auto-capture
  // consent toggle can actually be enforced. Optional because a caller that omits it (a direct
  // API-key integration, not one of the extension's known site adapters) has no toggle to check
  // against — the extension always sends its SiteAdapter.name here.
  platform: z.string().trim().min(1).max(50).optional(),
});
