import { NextFunction, Request, Response } from 'express';
import { AppError } from './errors';
import { asyncHandler } from './errorHandler';

// See docs/Phase8_BrowserExtension_Implementation_Plan.md §4/§5.2. ApiKey.scopes has existed
// since Phase 1 but nothing read it until now — an extension-issued key is the first key in the
// system that must genuinely be restricted, even against a caller with valid auth. Mirrors
// requireBucketRole's shape exactly: a no-op for session auth (scopes only ever constrain API
// keys), a 403 for a key missing the required scope.
export function requireScope(scope: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw AppError.unauthorized();
    if (req.auth.via === 'session') return next();

    if (!req.auth.scopes?.includes(scope)) {
      throw AppError.forbidden(`This API key does not have the "${scope}" scope`, 'INSUFFICIENT_SCOPE');
    }
    return next();
  });
}
