import { z } from 'zod';

export const updateAutoCaptureSchema = z.object({
  // e.g. { "chatgpt": false, "claude": true } — unknown platforms default to enabled elsewhere.
  autoCapture: z.record(z.string(), z.boolean()),
});

export const updateSmartMemorySchema = z.object({
  enabled: z.boolean(),
});
