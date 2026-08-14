import crypto from 'crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { prisma } from '../../shared/prisma';
import { sha256Hex } from '../../shared/tokens';

function toClientInformationFull(client: {
  id: string;
  clientName: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  grantTypes: string[];
  scope: string | null;
  createdAt: Date;
  clientSecretExpiresAt: Date | null;
}, rawSecret?: string): OAuthClientInformationFull {
  return {
    client_id: client.id,
    client_secret: rawSecret,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_secret_expires_at: client.clientSecretExpiresAt ? Math.floor(client.clientSecretExpiresAt.getTime() / 1000) : 0,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: client.grantTypes,
    response_types: ['code'],
    client_name: client.clientName ?? undefined,
    scope: client.scope ?? undefined,
  };
}

/**
 * Phase 16 (US-INT-03b): Dynamic Client Registration, backed by Postgres instead of the SDK's
 * in-memory example. `getClient()` never returns the raw secret (there isn't one stored — only
 * its hash), matching the same "never re-derivable, only checkable" discipline apikey.service.ts
 * already uses for API keys. The SDK's own client-auth middleware, which would want to read a raw
 * secret back off this store, is deliberately not used here (see mcp.routes.ts) — this codebase's
 * client-auth path (in mcp-oauth.provider.ts's exchange methods) hashes the presented secret and
 * compares hashes instead, the same shape apiKeyService.issue()/authenticate.ts already use.
 */
export const mcpClientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId: string) {
    const client = await prisma.mcpClient.findUnique({ where: { id: clientId } });
    if (!client) return undefined;
    return toClientInformationFull(client);
  },

  async registerClient(client) {
    // Public clients (the overwhelming majority of real MCP clients — Claude Desktop, Cursor,
    // etc. — since they can't keep a secret on an end-user's machine) register with
    // token_endpoint_auth_method "none" and rely on PKCE alone; only a confidential client
    // (server-to-server) gets an actual secret minted and hashed here.
    const isPublicClient = client.token_endpoint_auth_method === 'none';
    const rawSecret = isPublicClient ? undefined : crypto.randomBytes(32).toString('hex');

    const created = await prisma.mcpClient.create({
      data: {
        clientSecretHash: rawSecret ? sha256Hex(rawSecret) : null,
        clientName: client.client_name,
        redirectUris: client.redirect_uris,
        tokenEndpointAuthMethod: client.token_endpoint_auth_method ?? 'none',
        grantTypes: client.grant_types ?? ['authorization_code', 'refresh_token'],
        scope: client.scope,
      },
    });

    return toClientInformationFull(created, rawSecret);
  },
};
