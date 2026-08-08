import { z } from 'zod';

export const updateAutoCaptureSchema = z.object({
  // e.g. { "chatgpt": false, "claude": true } — unknown platforms default to enabled elsewhere.
  autoCapture: z.record(z.string(), z.boolean()),
});

export const updateSmartMemorySchema = z.object({
  enabled: z.boolean(),
});

// Deliberately permissive at the schema layer so accountDeletionService.deleteAccount() stays the
// single place the exact confirmation string is enforced (US-ACC-06) — a missing field and a wrong
// value should fail for the same reason, with the same message, not one as a Zod shape error.
export const deleteAccountSchema = z.object({
  confirmation: z.string().optional(),
});
