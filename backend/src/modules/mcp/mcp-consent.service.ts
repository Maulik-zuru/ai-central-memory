import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { AUTHORIZATION_CODE_TTL_MS } from './mcp-oauth.provider';

async function requirePendingRequest(requestId: string) {
  const request = await prisma.mcpAuthorizationRequest.findUnique({
    where: { id: requestId },
    include: { client: true },
  });
  if (!request || request.resolvedAt || request.expiresAt < new Date()) {
    throw AppError.notFound('This connection request has expired or was already used. Try connecting again.', 'MCP_REQUEST_NOT_FOUND');
  }
  return request;
}

function withQuery(url: string, params: Record<string, string | undefined>) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) target.searchParams.set(key, value);
  }
  return target.toString();
}

/**
 * Phase 16 (US-INT-03b): the human half of the OAuth authorization flow. mcp-oauth.provider.ts's
 * `authorize()` redirects the browser to the dashboard with a request id; these two actions are
 * what the dashboard's consent screen actually calls once a logged-in user makes a choice.
 */
export const mcpConsentService = {
  /** What the consent screen needs to render — which app is asking, for what. */
  async describe(requestId: string) {
    const request = await requirePendingRequest(requestId);
    return {
      clientName: request.client.clientName ?? 'An MCP client',
      scopes: request.scopes,
    };
  },

  async approve(userId: string, requestId: string) {
    const request = await requirePendingRequest(requestId);

    const code = await prisma.$transaction(async (tx) => {
      const created = await tx.mcpAuthorizationCode.create({
        data: {
          clientId: request.clientId,
          userId,
          redirectUri: request.redirectUri,
          codeChallenge: request.codeChallenge,
          scopes: request.scopes,
          resource: request.resource,
          expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
        },
      });
      await tx.mcpAuthorizationRequest.update({ where: { id: requestId }, data: { resolvedAt: new Date() } });
      return created;
    });

    await auditService.record(userId, 'mcp.authorize.approve', { type: 'McpClient', id: request.clientId });
    return { redirectUrl: withQuery(request.redirectUri, { code: code.code, state: request.state ?? undefined }) };
  },

  async deny(userId: string, requestId: string) {
    const request = await requirePendingRequest(requestId);
    await prisma.mcpAuthorizationRequest.update({ where: { id: requestId }, data: { resolvedAt: new Date() } });
    await auditService.record(userId, 'mcp.authorize.deny', { type: 'McpClient', id: request.clientId });
    return {
      redirectUrl: withQuery(request.redirectUri, {
        error: 'access_denied',
        error_description: 'The user denied the request',
        state: request.state ?? undefined,
      }),
    };
  },
};
