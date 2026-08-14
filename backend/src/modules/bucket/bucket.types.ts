import { z } from 'zod';

export const createBucketSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  parentId: z.string().optional(),
  // ADR-0002: set once, immutably, at creation — no rename/move schema below ever accepts `type`.
  type: z.enum(['memory', 'file']).default('memory'),
});

export const renameBucketSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export const moveBucketSchema = z.object({
  parentId: z.string().nullable(),
});

// US-ORG-01: deleting a non-empty bucket must ask, not silently pick one. Omitted entirely when
// the bucket has no memories — the strategy question only makes sense once there's something to
// decide about.
export const deleteBucketSchema = z.object({
  strategy: z.enum(['move-to-default', 'delete-contents']).optional(),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'viewer']),
});

export const changeRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});

export const moveMemorySchema = z.object({
  bucketId: z.string().min(1),
});
