import { z } from 'zod';

export const importSchema = z.object({
  bucketId: z.string().min(1),
  platform: z.string().min(1),
});

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  bucketId: z.string().min(1).optional(),
  mode: z.enum(['semantic', 'precise']).default('semantic'),
});

// Phase 17 (US-ARC-07): MemoryPlugin_Clone_Spec.md §6's `POST /api/chat-history/inject` — the
// full six-stage pipeline (query expansion, hybrid+RRF, rerank, relevance assessment, context
// expansion, budgeted cited summarization), unlike `/search`'s raw-chunks-no-synthesis contract.
// `maxTokens` defaults to 600, capped at 2000, per the spec's own injection-endpoint budget.
export const injectSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  bucketId: z.string().min(1).optional(),
  maxTokens: z.coerce.number().int().min(1).max(2000).default(600),
});

export const listConversationsSchema = z.object({
  bucketId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// Phase 15 (US-INT-06): the programmatic JSON ingest path — same target shape as the file-import
// providers' ParsedConversation, but arriving as a direct request body instead of a parsed export
// file. `conversation.id` is required (not optional, unlike a file-import externalId) because
// upsert-by-id is the entire point of this endpoint (MemoryPlugin_Clone_Spec.md §6).
export const ingestCustomOnlineSchema = z.object({
  bucketId: z.string().min(1),
  platform: z.string().min(1),
  platformDisplayName: z.string().min(1).max(100).optional(),
  conversation: z.object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1),
          createdAt: z.coerce.date().optional(),
        }),
      )
      .min(1),
  }),
});

export const deleteConversationsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

// Phase 21 (MemoryPlugin_Clone_Spec.md §3.3): same bulk shape as delete — Exclude is the
// "wipe content, keep a placeholder, never re-import" sibling operation.
export const excludeConversationsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export const updateConversationSchema = z.object({
  pinned: z.boolean(),
});
