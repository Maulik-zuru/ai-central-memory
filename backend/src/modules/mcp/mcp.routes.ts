import { Router } from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { env } from '../../shared/env';
import { mcpOAuthProvider } from './mcp-oauth.provider';
import { mcpConsentRouter } from './mcp-consent.routes';
import { mcpTransportRouter } from './mcp-transport.routes';

const issuerUrl = new URL(env.apiPublicUrl);

/**
 * Aggregates Phase 16's three route groups behind one export so app.ts mounts a single import:
 *  - the SDK's own OAuth AS endpoints (register/authorize/token/revoke/.well-known/*), which
 *    MUST live at the application root per the SDK's own router.d.ts comment — NOT nested under
 *    an /api/mcp prefix, since OAuth discovery is specified as root-relative.
 *  - this codebase's consent screen endpoints (/api/mcp/consent/*), authenticated via the normal
 *    dashboard session/API-key `authenticate`.
 *  - the actual MCP transport (/api/mcp/mcp) and the export-conversation download capability URL
 *    (/api/mcp/exports/:id/download), both under /api/mcp.
 */
export const mcpOAuthAppRouter = mcpAuthRouter({
  provider: mcpOAuthProvider,
  issuerUrl,
  resourceServerUrl: new URL('/api/mcp/mcp', issuerUrl),
  resourceName: 'MemoryOS',
  scopesSupported: ['memories:read', 'memories:write', 'chat-history:read', 'files:read'],
});

export const mcpRouter = Router();
mcpRouter.use('/consent', mcpConsentRouter);
mcpRouter.use('/', mcpTransportRouter);
