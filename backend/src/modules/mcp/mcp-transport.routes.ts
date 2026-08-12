import { Router, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { asyncHandler } from '../../shared/errorHandler';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { requireMcpBearerAuth } from './mcp-bearer';
import { registerMemoryOsTools } from './mcp.tools';

export const mcpTransportRouter = Router();

/**
 * Stateless Streamable HTTP (mcp-builder's own recommendation over SSE, and simpler to scale than
 * a stateful session — see the skill's transport-selection guidance): a fresh McpServer +
 * transport per request, scoped to whichever user the bearer token resolved to. No session store,
 * no cross-request state — the tradeoff explicitly accepted for exactly the reasons
 * docs/MemoryPlugin_Parity_Implementation_Plan.md Phase 16 §4 names.
 */
mcpTransportRouter.post('/mcp', requireMcpBearerAuth, async (req: Request, res: Response) => {
  const userId = req.mcpAuth!.userId;
  const server = new McpServer({ name: 'memoryos-mcp-server', version: '1.0.0' });
  registerMemoryOsTools(server, { userId });

  try {
    // enableJsonResponse: the SDK defaults to SSE framing even for a single request/response, but
    // this transport is one-shot per HTTP call (no session to keep a stream open for) — plain JSON
    // is the correct fit, and it's what every non-streaming MCP HTTP client expects to parse.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    // handleRequest's declared parameter type carries the SDK's own `AuthInfo`-shaped `auth?`
    // field, which this app's `Request.auth` (shared/express.d.ts) doesn't structurally satisfy —
    // the same shape collision mcp-bearer.ts's comment describes, at a single call site rather
    // than a global augmentation this time. At runtime this handler never reads `req.auth`
    // (verification already happened in requireMcpBearerAuth, via `req.mcpAuth`), so the cast
    // costs nothing real.
    await transport.handleRequest(req as unknown as Parameters<typeof transport.handleRequest>[0], res, req.body);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Streamable HTTP is GET/DELETE-capable for server-initiated notifications and session teardown
// in stateful mode; this server runs stateless, so both are simply unsupported — matching the
// SDK's own stateless example rather than pretending to support session semantics that don't exist.
mcpTransportRouter.get('/mcp', (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed in stateless mode' }, id: null });
});
mcpTransportRouter.delete('/mcp', (_req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed in stateless mode' }, id: null });
});

// The `export_conversation` tool's capability URL — deliberately unauthenticated (see
// McpConversationExport's schema comment): possession of the unguessable id within the 15-minute
// window is the access control, the same trust model image-memory signed URLs use.
mcpTransportRouter.get(
  '/exports/:id/download',
  asyncHandler(async (req: Request, res: Response) => {
    const record = await prisma.mcpConversationExport.findUnique({ where: { id: req.params.id } });
    if (!record || record.expiresAt < new Date()) {
      throw AppError.notFound('This export link has expired or does not exist.', 'MCP_EXPORT_EXPIRED');
    }
    const buffer = await getStorageProvider().get(record.downloadKey);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(buffer);
  }),
);
