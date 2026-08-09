import { z } from 'zod';

export const claimSchema = z.object({
  code: z.string().min(1),
  deviceName: z.string().trim().min(1).max(80),
  // The two platforms this phase claims. Anything else is rejected rather than stored, so the
  // device list can render a platform label without a fallback branch for values that never
  // should have been written.
  platform: z.enum(['darwin', 'win32']),
  osVersion: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

export const statusQuerySchema = z.object({
  code: z.string().min(1),
});

export const heartbeatSchema = z.object({
  appVersion: z.string().trim().max(40).optional(),
  osVersion: z.string().trim().max(40).optional(),
});
