import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { env } from '../../shared/env';
import { memoryService } from '../memory/memory.service';
import { bucketService } from '../bucket/bucket.service';
import { categoryService } from '../category/category.service';
import { conversationService } from '../chat-history/conversation.service';
import { chatSearchService } from '../chat-history/chat-search.service';
import { fileSearchService } from '../file/file-search.service';

const PAGE_LIMIT = z.number().int().min(1).max(100).default(20);
const CONVERSATION_EXPORT_TTL_MS = 15 * 60 * 1000; // matches MemoryPlugin_Clone_Spec.md §4.2's 15-minute link
const DEFAULT_INJECT_TOKEN_BUDGET = 600; // MemoryPlugin_Clone_Spec.md §6's /inject default budget

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: unknown };
type ToolAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };

/**
 * A thin, deliberately type-erased wrapper around `McpServer.registerTool`. Calling the real
 * method directly, 13 times, with 13 differently-shaped `inputSchema` object literals in one
 * file, drove `tsc` into a multi-minute unbounded type-instantiation loop (TS2589) — the same
 * class of issue openapi.service.ts hit with `zod-to-json-schema`, and the same fix: `any` at the
 * one call site that resolves the SDK's expensive generic signature, so every *other* type in
 * this file (the handler argument shapes below, spelled out explicitly per tool) stays checked
 * normally. Runtime behavior is unaffected — the SDK only reads `config` and calls `handler`, it
 * never depends on what TS inferred here.
 */
function registerTool<Args>(
  server: McpServer,
  name: string,
  config: { title?: string; description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations?: ToolAnnotations },
  handler: (args: Args) => Promise<ToolResult>,
): void {
  (server.registerTool as (...args: unknown[]) => unknown)(name, config, handler);
}

/**
 * Phase 16 (US-INT-03a/b): the 13 MCP tools MemoryPlugin_Clone_Spec.md §4.2 documents, registered
 * on a per-request `McpServer` (see mcp-transport.routes.ts — stateless mode creates one per
 * call). Every handler closes over `userId`, resolved from the caller's verified access token
 * (remote/OAuth) — every tool call is therefore scoped by the exact same bucket-membership checks
 * every REST endpoint already enforces (`requireBucketMembership`/`accessibleBucketIds`); there is
 * no separate, weaker MCP-only authorization path.
 *
 * Tool names carry a `memoryos_` prefix — MemoryPlugin's own names (`store_memory`, etc.) are
 * kept as the base action/resource per mcp-builder's naming convention, but namespaced to this
 * product rather than a competitor's, so this server composes cleanly if a client also has other
 * MCP servers connected (see docs/MemoryPlugin_Parity_Implementation_Plan.md Phase 16 §4).
 */
export function registerMemoryOsTools(server: McpServer, ctx: { userId: string }) {
  const { userId } = ctx;

  registerTool<{ content: string; bucketId?: string }>(
    server,
    'memoryos_store_memory',
    {
      title: 'Store memory',
      description: 'Save a new memory (a short fact or preference). Call this proactively when the user shares something worth remembering.',
      inputSchema: {
        content: z.string().trim().min(1).max(4000).describe('The memory text to save'),
        bucketId: z.string().optional().describe('Bucket to save into; omitted saves to the default bucket'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ content, bucketId }) => {
      const memory = await memoryService.create(userId, content, 'manual', bucketId);
      return { content: [{ type: 'text', text: JSON.stringify(memory) }], structuredContent: memory };
    },
  );

  registerTool<{ bucketId?: string; cursor?: string; limit: number }>(
    server,
    'memoryos_get_memories_and_buckets',
    {
      title: 'Get memories and buckets',
      description: 'Load memories (optionally filtered by bucket) plus the full bucket list, in one call.',
      inputSchema: { bucketId: z.string().optional(), cursor: z.string().optional(), limit: PAGE_LIMIT },
      annotations: { readOnlyHint: true },
    },
    async ({ bucketId, cursor, limit }) => {
      const [memories, buckets] = await Promise.all([
        memoryService.list(userId, { cursor, limit, bucketId }),
        bucketService.list(userId),
      ]);
      const result = { memories: memories.items, next_cursor: memories.nextCursor, buckets };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerTool<{ query: string; bucketId?: string; limit: number }>(
    server,
    'memoryos_search_memories',
    {
      title: 'Search memories',
      description: 'Semantic search over memories, ranked by relevance.',
      inputSchema: {
        query: z.string().trim().min(1).describe('What to search for'),
        bucketId: z.string().optional(),
        limit: PAGE_LIMIT,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, bucketId, limit }) => {
      const { items, hasMore } = await memoryService.search(userId, { query, bucketId, limit });
      const result = { items, has_more: hasMore };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerTool<Record<string, never>>(
    server,
    'memoryos_list_buckets',
    { title: 'List buckets', description: 'List every bucket the caller can see.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      const buckets = await bucketService.list(userId);
      return { content: [{ type: 'text', text: JSON.stringify(buckets) }], structuredContent: { buckets } };
    },
  );

  registerTool<{ name: string; parentId?: string }>(
    server,
    'memoryos_create_bucket',
    {
      title: 'Create bucket',
      description: 'Create a new bucket to organize memories.',
      inputSchema: { name: z.string().trim().min(1).max(100), parentId: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ name, parentId }) => {
      const bucket = await bucketService.create(userId, name, parentId);
      return { content: [{ type: 'text', text: JSON.stringify(bucket) }], structuredContent: bucket };
    },
  );

  registerTool<{ memoryId?: string; memoryIds?: string[]; text?: string; bucketId?: string; bucketName?: string }>(
    server,
    'memoryos_update_or_move_memories',
    {
      title: 'Update or move memories',
      description:
        'Edit one memory\'s text and/or move it to another bucket, or move up to 100 memories in bulk. Bulk is ' +
        'move-only and all-or-nothing: if any id cannot be resolved, nothing is moved.',
      inputSchema: {
        memoryId: z.string().optional().describe('Set for a single edit/move'),
        memoryIds: z.array(z.string()).min(1).max(100).optional().describe('Set for a bulk move instead of memoryId'),
        text: z.string().trim().min(1).max(4000).optional(),
        bucketId: z.string().optional(),
        bucketName: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ memoryId, memoryIds, text, bucketId, bucketName }) => {
      if (memoryId) {
        let memory = await memoryService.get(userId, memoryId);
        if (text !== undefined) memory = await memoryService.update(userId, memoryId, text);
        if (bucketId || bucketName) {
          const targetBucketId = await memoryService.resolveBucketId(userId, { bucketId, bucketName });
          memory = await memoryService.move(userId, memoryId, targetBucketId);
        }
        return { content: [{ type: 'text', text: JSON.stringify(memory) }], structuredContent: memory };
      }
      if (memoryIds) {
        const result = await memoryService.bulkMove(userId, memoryIds, { bucketId, bucketName });
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      }
      throw AppError.badRequest('Provide either memoryId or memoryIds', 'MISSING_TARGET');
    },
  );

  registerTool<{ bucketId?: string }>(
    server,
    'memoryos_list_bucket_categories',
    {
      title: 'List bucket categories',
      description:
        'Smart-Memory category summaries — tier 1 of the two-tier recall mechanism. Each category ' +
        'carries a label, a summary, and additionalContext written specifically to help you decide ' +
        'whether the current conversation is relevant enough to load its full memory list via ' +
        'memoryos_list_category_memories (tier 2). Optionally filtered to one bucket; omit ' +
        'bucketId to see every category across every bucket you can access. A bucket with no ' +
        'categories yet has not been through Smart Memory\'s batch categorization job.',
      inputSchema: { bucketId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ bucketId }) => {
      const categories = await categoryService.list(userId, bucketId);
      return { content: [{ type: 'text', text: JSON.stringify(categories) }], structuredContent: { categories } };
    },
  );

  registerTool<{ categoryId: string; cursor?: string; limit: number }>(
    server,
    'memoryos_list_category_memories',
    {
      title: 'List category memories',
      description:
        'Tier 2 of the two-tier recall mechanism — the full memory list within one Smart-Memory ' +
        'category, loaded on demand. Call this only after memoryos_list_bucket_categories suggests ' +
        'the category is relevant to the current conversation; loading every category defeats the ' +
        'point of the summary-first design.',
      inputSchema: { categoryId: z.string().min(1), cursor: z.string().optional(), limit: PAGE_LIMIT },
      annotations: { readOnlyHint: true },
    },
    async ({ categoryId, cursor, limit }) => {
      const { items, nextCursor } = await categoryService.listMemories(userId, categoryId, { cursor, limit });
      const result = { memories: items, next_cursor: nextCursor };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerTool<{ query: string; bucketId?: string }>(
    server,
    'memoryos_recall_chat_history',
    {
      title: 'Recall chat history',
      description: 'Search and AI-synthesize context from past conversations, with cited sources.',
      inputSchema: { query: z.string().trim().min(1), bucketId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, bucketId }) => {
      // Phase 17 (US-ARC-07): the same six-stage recall pipeline the REST /inject endpoint
      // calls — "one pipeline, multiple callers" — not the older, generic Ask multi-source path.
      const result = await chatSearchService.inject(userId, { query, bucketId, maxTokens: DEFAULT_INJECT_TOKEN_BUDGET });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerTool<{ conversationId: string }>(
    server,
    'memoryos_get_conversation_summary',
    {
      title: 'Get conversation summary',
      description: 'The stored summary of one past conversation (full transcript for short chats).',
      inputSchema: { conversationId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ conversationId }) => {
      const result = await conversationService.getTranscript(userId, conversationId, { limit: 50 });
      const payload = { conversation: result.conversation, summary: result.conversation.summary, previewMessages: result.messages };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
    },
  );

  registerTool<{ conversationId: string; cursor?: number }>(
    server,
    'memoryos_get_full_conversation',
    {
      title: 'Get full conversation',
      description: 'The complete transcript of one past conversation.',
      inputSchema: { conversationId: z.string().min(1), cursor: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ conversationId, cursor }) => {
      const result = await conversationService.getTranscript(userId, conversationId, { cursor, limit: 100 });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerTool<{ conversationId: string }>(
    server,
    'memoryos_export_conversation',
    {
      title: 'Export conversation',
      description: 'A temporary (15-minute) download link for one conversation as JSON.',
      inputSchema: { conversationId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ conversationId }) => {
      // Pulled in full, not the default 50/100-message page — an export is meant to be complete.
      const full: { messages: unknown[] } & Record<string, unknown> = { messages: [] };
      let cursor: number | undefined;
      for (;;) {
        const chunk = await conversationService.getTranscript(userId, conversationId, { cursor, limit: 500 });
        full.conversation = chunk.conversation;
        full.messages = [...(full.messages as unknown[]), ...chunk.messages];
        if (chunk.nextCursor === null) break;
        cursor = chunk.nextCursor;
      }

      const stored = await getStorageProvider().putPrivate(
        Buffer.from(JSON.stringify(full, null, 2)),
        `conversation-${conversationId}-export.json`,
      );
      const expiresAt = new Date(Date.now() + CONVERSATION_EXPORT_TTL_MS);
      const record = await prisma.mcpConversationExport.create({ data: { downloadKey: stored.key, expiresAt } });

      const result = { downloadUrl: `${env.apiPublicUrl}/api/mcp/exports/${record.id}/download`, expiresAt };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerTool<{ query: string; bucketId?: string }>(
    server,
    'memoryos_search_uploaded_files',
    {
      title: 'Search uploaded files',
      description: 'Search file-bucket documents; returns passages with file name and page.',
      inputSchema: { query: z.string().trim().min(1), bucketId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, bucketId }) => {
      const results = await fileSearchService.search(userId, { query, bucketId });
      return { content: [{ type: 'text', text: JSON.stringify(results) }], structuredContent: { results } };
    },
  );
}
