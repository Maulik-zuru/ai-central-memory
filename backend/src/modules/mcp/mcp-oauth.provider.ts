import crypto from 'crypto';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { prisma } from '../../shared/prisma';
import { sha256Hex } from '../../shared/tokens';
import { env } from '../../shared/env';
import { mcpClientsStore } from './mcp-clients.store';

const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the consent screen
const AUTHORIZATION_CODE_TTL_MS = 60 * 1000; // RFC 6749 §4.1.2 recommends a short window
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Phase 16 (US-INT-03b): the `OAuthServerProvider` this codebase implements for the SDK's
 * `mcpAuthRouter`. Every method here is a small, direct translation of one OAuth step onto the
 * four models in schema.prisma's Phase 16 section — see that section's comments for why each
 * model looks the way it does (single-use codes, in-place refresh rotation, hashed tokens).
 *
 * `authorize()` is the one method that can't just read/write a database row and return — a real
 * user has to see and approve a consent screen, which lives on the frontend, not here. This
 * implementation's job is exactly two things: persist enough about the pending request that the
 * frontend can render it, and redirect the browser there. mcp-consent.routes.ts is the other half
 * — the endpoints the frontend calls once a logged-in user actually clicks Approve.
 */
export const mcpOAuthProvider: OAuthServerProvider = {
  clientsStore: mcpClientsStore,

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const request = await prisma.mcpAuthorizationRequest.create({
      data: {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scopes: params.scopes ?? [],
        state: params.state,
        resource: params.resource?.toString(),
        expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
      },
    });

    res.redirect(302, `${env.corsOrigin}/mcp/authorize?request=${request.id}`);
  },

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = await prisma.mcpAuthorizationCode.findUnique({ where: { code: authorizationCode } });
    if (!code || code.clientId !== client.client_id || code.consumedAt || code.expiresAt < new Date()) {
      throw new InvalidGrantError('Invalid, expired, or already-used authorization code');
    }
    return code.codeChallenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // PKCE itself was already checked by the SDK's token handler (it calls
    // challengeForAuthorizationCode() and compares codeVerifier before this method ever runs) —
    // this re-checks the same expiry/consumption/client-match invariants challengeForAuthorizationCode
    // did, since exchange is the point where the code actually gets spent, not just inspected.
    const code = await prisma.mcpAuthorizationCode.findUnique({ where: { code: authorizationCode } });
    if (!code || code.clientId !== client.client_id || code.consumedAt || code.expiresAt < new Date()) {
      throw new InvalidGrantError('Invalid, expired, or already-used authorization code');
    }
    if (redirectUri && code.redirectUri !== redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the one used to obtain this code');
    }

    await prisma.mcpAuthorizationCode.update({ where: { code: authorizationCode }, data: { consumedAt: new Date() } });

    const rawAccessToken = randomToken();
    const rawRefreshToken = randomToken();
    const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

    await prisma.mcpToken.create({
      data: {
        clientId: client.client_id,
        userId: code.userId,
        accessTokenHash: sha256Hex(rawAccessToken),
        refreshTokenHash: sha256Hex(rawRefreshToken),
        scopes: code.scopes,
        resource: resource?.toString() ?? code.resource,
        accessTokenExpiresAt,
      },
    });

    return {
      access_token: rawAccessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: rawRefreshToken,
      scope: code.scopes.join(' ') || undefined,
    };
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const existing = await prisma.mcpToken.findUnique({ where: { refreshTokenHash: sha256Hex(refreshToken) } });
    if (!existing || existing.clientId !== client.client_id || existing.revokedAt) {
      throw new InvalidGrantError('Invalid, revoked, or unrecognized refresh token');
    }

    // In-place rotation, not a new row: a stolen refresh token that's already been used by the
    // legitimate client silently stops working the instant this runs, rather than both the thief
    // and the legitimate client having a live, independently-valid token going forward.
    const rawAccessToken = randomToken();
    const rawRefreshToken = randomToken();
    const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    const nextScopes = scopes ?? existing.scopes;

    await prisma.mcpToken.update({
      where: { id: existing.id },
      data: {
        accessTokenHash: sha256Hex(rawAccessToken),
        refreshTokenHash: sha256Hex(rawRefreshToken),
        scopes: nextScopes,
        resource: resource?.toString() ?? existing.resource,
        accessTokenExpiresAt,
      },
    });

    return {
      access_token: rawAccessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: rawRefreshToken,
      scope: nextScopes.join(' ') || undefined,
    };
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await prisma.mcpToken.findUnique({ where: { accessTokenHash: sha256Hex(token) } });
    if (!record || record.revokedAt || record.accessTokenExpiresAt < new Date()) {
      throw new Error('Invalid, revoked, or expired access token');
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.accessTokenExpiresAt.getTime() / 1000),
      resource: record.resource ? new URL(record.resource) : undefined,
      extra: { userId: record.userId },
    };
  },

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = sha256Hex(request.token);
    const record = await prisma.mcpToken.findFirst({
      where: { clientId: client.client_id, OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }] },
    });
    // Per the interface's own contract: an already-invalid or unrecognized token is a no-op, not
    // an error — a client revoking a token it already revoked (or never had) shouldn't see a
    // failure for something that was never a security-relevant event.
    if (!record || record.revokedAt) return;
    await prisma.mcpToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  },
};

export { AUTHORIZATION_CODE_TTL_MS };
