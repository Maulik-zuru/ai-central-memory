import { z } from 'zod';

export const createBucketSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  parentId: z.string().optional(),
});

export const renameBucketSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export const moveBucketSchema = z.object({
  parentId: z.string().nullable(),
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
