import { zodToJsonSchema } from 'zod-to-json-schema';
import { createMemorySchema, bulkDeleteMemoriesSchema } from '../memory/memory.types';
import { createBucketSchema } from '../bucket/bucket.types';
import { searchSchema, injectSchema, ingestCustomOnlineSchema, deleteConversationsSchema } from '../chat-history/chat-history.types';

/**
 * Phase 15 (US-INT-06): a generated OpenAPI 3.0 document, not a hand-maintained one — every
 * request/response shape below is produced from the exact same Zod schemas the routes themselves
 * validate against (memory.types.ts, bucket.types.ts, chat-history.types.ts), so this document
 * cannot silently drift out of sync with what a request actually needs to look like the way a
 * separately-authored spec file would.
 *
 * Scope, stated plainly rather than left implicit: this document covers the 16 endpoints named in
 * MemoryPlugin_Clone_Spec.md §6 as this codebase's public, integration-facing surface (mapped onto
 * our actual paths — see each operation's `description` for where a path/shape deliberately
 * differs from the spec's own naming). Every other mounted router (auth, account, API keys,
 * capture, invites, context, categories, files, ask, extension, desktop, intelligence, billing,
 * ops) is dashboard/first-party-client-only and is declared internal at the router level via
 * `x-internal-routers` below, rather than enumerated route-by-route — OpenAPI's `paths` object
 * only accepts literal path templates, so there is no structurally valid way to mark "everything
 * under this prefix" inline in `paths` itself. `POST /api/chat-history/inject` (the spec's
 * AI-synthesized recall endpoint) shipped in Phase 17, once the six-stage recall pipeline
 * (backend/src/modules/chat-history/recall.service.ts) existed underneath it.
 */

// `zod-to-json-schema`'s generic signature drives `tsc` into an unbounded type-instantiation loop
// (TS2589) against several of this codebase's schemas — naming the parameter type via
// `Parameters<typeof zodToJsonSchema>[0]` doesn't help, since that type alias *is* the same
// expensive generic. `any` is the actual fix: it tells the compiler to skip structural inference
// for this argument entirely rather than trying and failing to narrow it. Runtime behavior is
// unaffected — zodToJsonSchema works the same regardless of what TS believes about its input type.
function schema(zodSchema: any) {
  return zodToJsonSchema(zodSchema, { target: 'openApi3', $refStrategy: 'none' });
}

const jsonBody = (zodSchema: any) => ({
  required: true,
  content: { 'application/json': { schema: schema(zodSchema) } },
});

const jsonResponse = (description: string, exampleSchema?: object) => ({
  description,
  ...(exampleSchema ? { content: { 'application/json': { schema: exampleSchema } } } : {}),
});

const BEARER_AUTH = [{ bearerAuth: [] }];

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'AI Central Memory API',
      version: '2026-08-11',
      description:
        'The public, integration-facing surface of this platform — memories, buckets, and chat-history ' +
        'archive. Every other endpoint under /api/* is internal (dashboard/first-party clients only); see ' +
        '`x-internal-routers` for the full list of prefixes not covered by this document.',
    },
    servers: [{ url: baseUrl }],
    'x-internal-routers': [
      '/api/auth',
      '/api/keys',
      '/api/account',
      '/api/suggestions',
      '/api/capture',
      '/api/invites',
      '/api/context',
      '/api/categories',
      '/api/files',
      '/api/ask',
      '/api/extension',
      '/api/desktop',
      '/api/intelligence',
      '/api/billing',
      '/api/ops',
      // Not every route under /api/memories and /api/chat-history is public either — only the
      // operations listed in `paths` below are; PATCH-by-id text edit, one-click save, image
      // upload, merge, and per-conversation search/insights/transcript stay dashboard-only for now.
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'An API key from Settings → API Keys.' },
      },
    },
    security: BEARER_AUTH,
    paths: {
      '/api/memories': {
        post: {
          summary: 'Create a memory',
          tags: ['Memory'],
          security: BEARER_AUTH,
          requestBody: jsonBody(createMemorySchema),
          responses: { '201': jsonResponse('The created memory.') },
        },
        get: {
          summary: 'List memories',
          description:
            'Cursor-paginated. MemoryPlugin_Clone_Spec.md §6 documents this as the v1 shape (`query`/`all`/' +
            '`latest`/`count`/`skip`/`source` params); this API uses `q`/`cursor`/`limit`/`bucketId` instead — ' +
            'a documented deviation, not an oversight.',
          tags: ['Memory'],
          security: BEARER_AUTH,
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'bucketId', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': jsonResponse('A page of memories.') },
        },
      },
      '/api/memories/{memoryId}': {
        delete: {
          summary: 'Delete one memory',
          tags: ['Memory'],
          security: BEARER_AUTH,
          parameters: [{ name: 'memoryId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Deleted.' } },
        },
      },
      '/api/memories/bulk-delete': {
        post: {
          summary: 'Delete many memories',
          description: 'Per-ID, not all-or-nothing — one inaccessible ID does not block deleting the rest.',
          tags: ['Memory'],
          security: BEARER_AUTH,
          requestBody: jsonBody(bulkDeleteMemoriesSchema),
          responses: { '200': jsonResponse('Counts of what succeeded and failed.') },
        },
      },
      '/api/v2/memory': {
        get: {
          summary: 'Get memories and buckets in one call',
          tags: ['Memory'],
          security: BEARER_AUTH,
          parameters: [
            { name: 'bucketId', in: 'query', schema: { type: 'string' } },
            { name: 'contentType', in: 'query', schema: { type: 'string', enum: ['text', 'image'] } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          ],
          responses: { '200': jsonResponse('Memories and the full bucket list, together.') },
        },
      },
      '/api/v2/memory/update': {
        post: {
          summary: 'Edit one memory, or move up to 100 memories in bulk',
          description:
            'A discriminated union: `memoryId` + `text`/`bucketId`/`bucketName` for a single edit/move, or ' +
            '`memoryIds[]` (max 100) + `bucketId`/`bucketName` for a bulk move. Bulk is move-only and ' +
            'all-or-nothing — see the 404 response.',
          tags: ['Memory'],
          security: BEARER_AUTH,
          // Hand-written, not generated from v2MemoryUpdateSchema like every other body in this
          // file — that schema is a union of a `.refine()`-wrapped object with another
          // `.refine()`-wrapped object, and feeding that specific shape through
          // zod-to-json-schema drove `tsc` into a multi-minute, unbounded type-instantiation loop
          // (TS2589) at the call site. This is the one deliberate, documented exception to "every
          // shape below comes from the real Zod schema" — the two branches here are transcribed
          // by hand from v2MemoryUpdateSchema (memory.types.ts) and must be kept in sync manually
          // if that schema's shape changes.
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      required: ['memoryId'],
                      properties: {
                        memoryId: { type: 'string' },
                        text: { type: 'string', minLength: 1, maxLength: 4000 },
                        bucketId: { type: 'string' },
                        bucketName: { type: 'string' },
                      },
                    },
                    {
                      type: 'object',
                      required: ['memoryIds'],
                      properties: {
                        memoryIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
                        bucketId: { type: 'string' },
                        bucketName: { type: 'string' },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('The updated memory (single) or the count moved (bulk).'),
            '404': jsonResponse('Bulk only: one or more IDs could not be resolved — nothing was moved. `rejectedIds` lists them.'),
          },
        },
      },
      '/api/buckets': {
        get: { summary: 'List buckets', tags: ['Bucket'], security: BEARER_AUTH, responses: { '200': jsonResponse('Every bucket you can see.') } },
        post: {
          summary: 'Create a bucket',
          tags: ['Bucket'],
          security: BEARER_AUTH,
          requestBody: jsonBody(createBucketSchema),
          responses: { '201': jsonResponse('The created bucket.') },
        },
      },
      '/api/chat-history/search': {
        post: {
          summary: 'Raw search over chat history — matched chunks and scores, no synthesis',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          requestBody: jsonBody(searchSchema),
          responses: { '200': jsonResponse('Matched chunks, ranked.') },
        },
      },
      '/api/chat-history/inject': {
        post: {
          summary: 'Recall: hybrid search + AI-synthesized, cited summary',
          description:
            'The full six-stage recall pipeline (MemoryPlugin_Clone_Spec.md §5.4): query expansion, hybrid ' +
            'dense+keyword search fused by Reciprocal Rank Fusion, rerank, per-chunk relevance assessment, ' +
            'context expansion, and a token-budgeted summary with citations.',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          requestBody: jsonBody(injectSchema),
          responses: { '200': jsonResponse('A synthesized, cited summary.') },
        },
      },
      '/api/chat-history/conversations': {
        get: {
          summary: 'List imported conversations',
          description: 'MemoryPlugin_Clone_Spec.md §6 names this `GET /api/chat-history/chats` — documented path deviation.',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          responses: { '200': jsonResponse('A page of conversations.') },
        },
      },
      '/api/chat-history/conversations/{id}': {
        get: {
          summary: 'Full transcript of one conversation',
          description:
            'MemoryPlugin_Clone_Spec.md §6 names this `GET /api/chat-history/conversation?conversationId=` — ' +
            'documented path-style deviation (path param instead of query param).',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': jsonResponse('The conversation and a page of its messages.') },
        },
      },
      '/api/chat-history/usage': {
        get: {
          summary: 'Per-platform import usage against the plan limit',
          description: 'MemoryPlugin_Clone_Spec.md §6 names this `GET /api/chat-history/count` — this returns a richer, per-platform breakdown rather than one flat number.',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          responses: { '200': jsonResponse('Per-platform counts and the plan limit.') },
        },
      },
      '/api/chat-history/ingest/custom-online': {
        post: {
          summary: 'Push one conversation in — upsert by conversation.id',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          requestBody: jsonBody(ingestCustomOnlineSchema),
          responses: { '202': jsonResponse('Queued for processing.'), '400': jsonResponse('Over the 100,000-token ingest limit.') },
        },
      },
      '/api/chat-history/chats': {
        delete: {
          summary: 'Delete conversations — irreversible',
          description:
            'A resync or re-import of the same source conversation may recreate it. For "never bring this ' +
            'back," see the not-yet-built Exclude operation (docs/MemoryPlugin_Parity_Implementation_Plan.md Phase 22).',
          tags: ['Chat History'],
          security: BEARER_AUTH,
          requestBody: jsonBody(deleteConversationsSchema),
          responses: { '200': jsonResponse('Counts of what was deleted and what failed.') },
        },
      },
    },
  };
}
