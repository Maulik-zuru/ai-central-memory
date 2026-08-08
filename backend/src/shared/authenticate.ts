import { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma';
import { AppError } from './errors';
import { sha256Hex, verifyAccessToken } from './tokens';
import { asyncHandler } from './errorHandler';

const API_KEY_PREFIX = 'mp_';

// Downstream code calls req.auth.userId and doesn't care whether the caller authenticated with a
// dashboard session or a programmatic API key — see Backend_Plan.md Phase 1.
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing or malformed Authorization header');
  }
  const token = header.slice('Bearer '.length).trim();

  if (token.startsWith(API_KEY_PREFIX)) {
    const keyHash = sha256Hex(token);
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

    if (!apiKey || apiKey.revokedAt) {
      // Revoked keys must fail on the very next request — no cached-empty-result path (US-ACC-03 AC).
      throw AppError.unauthorized('API key is invalid or revoked', 'INVALID_API_KEY');
    }

    // Fire-and-forget last-used touch; doesn't block the request.
    void prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.auth = { userId: apiKey.userId, via: 'apiKey', apiKeyId: apiKey.id, scopes: apiKey.scopes };
    return next();
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, via: 'session', sessionId: payload.sessionId };
    return next();
  } catch {
    throw AppError.unauthorized('Invalid or expired access token', 'INVALID_ACCESS_TOKEN');
  }
});
