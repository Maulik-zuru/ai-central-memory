import { z } from 'zod';
import { writeFile } from 'fs/promises';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryOsApiClient } from './client';

const PAGE_LIMIT = z.number().int().min(1).max(100).default(20);

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError?: boolean };
type ToolAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };

// Same type-erasure wrapper backend/src/modules/mcp/mcp.tools.ts uses, for the same reason:
// McpServer.registerTool's generic signature drives tsc into an unbounded type-instantiation loop
// (TS2589) once it's called this many times with differently-shaped inputSchema literals in one
// file. `any` at this one call site is the fix — every handler's argument type below is still
// checked normally, since it's spelled out explicitly per tool.
function registerTool<Args>(
  server: McpServer,
  name: string,
  config: { title?: string; description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations?: ToolAnnotations },
  handler: (args: Args) => Promise<ToolResult>,
): void {
  (server.registerTool as (...args: unknown[]) => unknown)(name, config, handler);
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
}

// Per the mcp-builder skill's error-handling guidance: a failed call is a tool-level result
// (isError: true), not a thrown protocol error — the model sees the message and can react (e.g.
// call memoryos_list_buckets after an unresolved bucketId) instead of the call just dying.
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Phase 16 (US-INT-03a): the same 13 tools the remote server registers
 * (backend/src/modules/mcp/mcp.tools.ts), reimplemented here as REST calls through
 * `MemoryOsApiClient` instead of direct service/Prisma access — this process has no database
 * connection, only the API key the user pasted into their MCP client config. Tool names,
 * descriptions, schemas, and annotations are kept identical across both servers on purpose: a
 * client shouldn't be able to tell which transport answered a given call.
 */
export function registerMemoryOsTools(server: McpServer, client: MemoryOsApiClient) {
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
      try {
        const { memory } = await client.createMemory(content, bucketId);
        return ok(memory);
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const result = await client.getMemoriesAndBuckets({ bucketId, cursor, limit });
        return ok(result);
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const { items, hasMore } = await client.searchMemories({ query, bucketId, limit });
        return ok({ items, has_more: hasMore });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  registerTool<Record<string, never>>(
    server,
    'memoryos_list_buckets',
    { title: 'List buckets', description: 'List every bucket the caller can see.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      try {
        const { buckets } = await client.listBuckets();
        return ok({ buckets });
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const { bucket } = await client.createBucket(name, parentId);
        return ok(bucket);
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        if (memoryId) {
          const { memory } = await client.updateOrMoveMemory({ memoryId, text, bucketId, bucketName });
          return ok(memory);
        }
        if (memoryIds) {
          const result = await client.bulkMoveMemories({ memoryIds, bucketId, bucketName });
          return ok(result);
        }
        return fail('Provide either memoryId or memoryIds');
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  registerTool<{ bucketId?: string }>(
    server,
    'memoryos_list_bucket_categories',
    {
      title: 'List bucket categories',
      description:
        'Smart-Memory categories for the caller\'s memories, optionally filtered to one bucket. ' +
        '(Categories are account-scoped today, not yet per-bucket — see Phase 20.)',
      inputSchema: { bucketId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ bucketId }) => {
      try {
        const { categories } = await client.listBucketCategories(bucketId);
        return ok({ categories });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  registerTool<{ categoryId: string; cursor?: string; limit: number }>(
    server,
    'memoryos_list_category_memories',
    {
      title: 'List category memories',
      description: 'The full memory list within one Smart-Memory category.',
      inputSchema: { categoryId: z.string().min(1), cursor: z.string().optional(), limit: PAGE_LIMIT },
      annotations: { readOnlyHint: true },
    },
    async ({ categoryId, cursor, limit }) => {
      try {
        const { items, nextCursor } = await client.listCategoryMemories(categoryId, { cursor, limit });
        return ok({ memories: items, next_cursor: nextCursor });
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const { message } = await client.recallChatHistory(query, bucketId);
        return ok(message);
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const result = await client.getConversation(conversationId, { limit: 50 });
        const conversation = result.conversation as { summary?: unknown };
        const payload = { conversation: result.conversation, summary: conversation.summary, previewMessages: result.messages };
        return ok(payload);
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const result = await client.getConversation(conversationId, { cursor, limit: 100 });
        return ok(result);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  registerTool<{ conversationId: string; outputDir?: string }>(
    server,
    'memoryos_export_conversation',
    {
      title: 'Export conversation',
      description:
        'Write one conversation\'s full transcript to a local JSON file and return its path. Unlike the remote ' +
        'server\'s download-link version, this runs on the user\'s own machine, so the export is just a file.',
      inputSchema: {
        conversationId: z.string().min(1),
        outputDir: z.string().optional().describe('Directory to write into; defaults to the current working directory'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ conversationId, outputDir }) => {
      try {
        // Pulled in full, not the default 50/100-message page — an export is meant to be complete.
        const full: { messages: unknown[] } & Record<string, unknown> = { messages: [] };
        let cursor: number | undefined;
        for (;;) {
          const chunk = await client.getConversation(conversationId, { cursor, limit: 500 });
          full.conversation = chunk.conversation;
          full.messages = [...(full.messages as unknown[]), ...chunk.messages];
          if (chunk.nextCursor === null) break;
          cursor = chunk.nextCursor;
        }

        const dir = outputDir ?? process.env.MEMORYOS_EXPORT_DIR ?? process.cwd();
        const filePath = path.join(dir, `conversation-${conversationId}-export.json`);
        await writeFile(filePath, JSON.stringify(full, null, 2), 'utf8');

        return ok({ filePath });
      } catch (err) {
        return fail((err as Error).message);
      }
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
      try {
        const { results } = await client.searchUploadedFiles(query, bucketId);
        return ok({ results });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
