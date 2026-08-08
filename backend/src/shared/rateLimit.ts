import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Phase 1 uses in-memory rate limiting (express-rate-limit's default store). It's provisioned as
// a Redis-backed store from Phase 4 onward once multiple API instances are running behind a
// load balancer — see Backend_Plan.md Phase 0/4.

// Tighter limit on auth endpoints: credential-stuffing / brute-force surface.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
});

// General per-identity limit applied after authentication, keyed by user id when available so one
// user's traffic can't starve another's, falling back to IP for unauthenticated routes.
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'anonymous',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
});
