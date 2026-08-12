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

// Phase 15 (US-INT-06): bulk move is move-only and all-or-nothing — see memory.service.ts's
// bulkMove() for what "all-or-nothing" actually enforces. Exactly one of bucketId/bucketName,
// matching MemoryPlugin_Clone_Spec.md §6's `POST /api/v2/memory/update` bulk shape.
export const bulkMoveMemoriesSchema = z
  .object({
    memoryIds: z.array(z.string().min(1)).min(1).max(100),
    bucketId: z.string().min(1).optional(),
    bucketName: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.bucketId) !== Boolean(v.bucketName), {
    message: 'Provide exactly one of bucketId or bucketName',
  });

export const bulkDeleteMemoriesSchema = z.object({
  memoryIds: z.array(z.string().min(1)).min(1).max(100),
});

// Phase 15: the versioned public endpoint unifies single-memory edit/move and bulk move into one
// request shape (MemoryPlugin_Clone_Spec.md §6's `POST /api/v2/memory/update`) — a discriminated
// union on `memoryId` (single) vs. `memoryIds` (bulk) rather than two endpoints, matching the spec.
export const v2MemoryUpdateSchema = z.union([
  z
    .object({
      memoryId: z.string().min(1),
      text: z.string().trim().min(1).max(4000).optional(),
      bucketId: z.string().min(1).optional(),
      bucketName: z.string().min(1).optional(),
    })
    .refine((v) => v.text !== undefined || v.bucketId !== undefined || v.bucketName !== undefined, {
      message: 'Provide text and/or a bucket to move the memory to',
    }),
  bulkMoveMemoriesSchema,
]);

export const v2MemoryQuerySchema = z.object({
  bucketId: z.string().optional(),
  contentType: z.enum(['text', 'image']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const captureSchema = z.object({
  snippet: z.string().trim().min(1).max(8000),
  // Phase 11 (US-ACC-07): which platform the snippet came from, so the per-platform auto-capture
  // consent toggle can actually be enforced. Optional because a caller that omits it (a direct
  // API-key integration, not one of the extension's known site adapters) has no toggle to check
  // against — the extension always sends its SiteAdapter.name here.
  platform: z.string().trim().min(1).max(50).optional(),
});
