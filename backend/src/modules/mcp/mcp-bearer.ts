import { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../shared/errorHandler';
import { AppError } from '../../shared/errors';
import { mcpOAuthProvider } from './mcp-oauth.provider';

/**
 * A deliberately hand-written equivalent of the SDK's own `requireBearerAuth` middleware — not a
 * reach for novelty. The SDK's version (server/auth/middleware/bearerAuth.js) globally augments
 * `express-serve-static-core.Request.auth` to its own `AuthInfo` shape, which collides with this
 * app's pre-existing `Request.auth` augmentation (shared/express.d.ts, used by every other module
 * in the codebase via `req.auth.userId`) the moment anything imports that file — confirmed by
 * spiking it: importing `requireBearerAuth` anywhere turned every existing `req.auth.userId`
 * call site in the app into a type error, because TS resolves the merged `auth` property to
 * whichever augmentation's type wins, not both. This file exists so the MCP transport route can
 * verify a token without ever pulling that file into the compilation graph. `req.mcpAuth` is a
 * new, unrelated property name specifically to avoid the collision, not a copy of the SDK's shape.
 */

declare module 'express-serve-static-core' {
  interface Request {
    mcpAuth?: { userId: string; clientId: string; scopes: string[] };
  }
}

export const requireMcpBearerAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing or malformed Authorization header', 'MISSING_BEARER_TOKEN');
  }
  const token = header.slice('Bearer '.length).trim();

  let info;
  try {
    info = await mcpOAuthProvider.verifyAccessToken(token);
  } catch {
    throw AppError.unauthorized('Invalid, expired, or revoked access token', 'INVALID_MCP_TOKEN');
  }

  const userId = info.extra?.userId;
  if (typeof userId !== 'string') {
    throw AppError.unauthorized('Malformed access token', 'INVALID_MCP_TOKEN');
  }

  req.mcpAuth = { userId, clientId: info.clientId, scopes: info.scopes };
  next();
});
