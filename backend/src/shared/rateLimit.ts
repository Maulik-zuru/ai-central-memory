import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Phase 1 uses in-memory rate limiting (express-rate-limit's default store). It's provisioned as
// a Redis-backed store from Phase 4 onward once multiple API instances are running behind a
// load balancer — see Backend_Plan.md Phase 0/4.

// Every request in the test suite originates from the same loopback IP, so the IP-keyed limits
// below are shared by the whole run. A suite that registers more than `limit` accounts starts
// getting 429s partway through — surfacing as baffling downstream failures ("account.id is
// undefined") in whichever test happens to cross the threshold, which varies with ordering and
// timing. Rate limiting is not what those tests assert, so it is bypassed by default under test.
//
// Bypassing a security control in tests would normally mean losing all coverage of it, so the
// bypass is itself switchable: tests/rate-limit.test.ts turns limiting back on and proves the
// limiters actually reject once the threshold is crossed.
const isTest = () => process.env.NODE_ENV === 'test';
let enabledInTests = false;
const skip = () => isTest() && !enabledInTests;

/** Test-only: re-enable rate limiting so the limiters themselves can be exercised. */
export function __setRateLimitEnabledForTests(enabled: boolean) {
  enabledInTests = enabled;
}

// Tighter limit on auth endpoints: credential-stuffing / brute-force surface.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
  skip,
});

// Extension pairing has no authenticated identity yet (start/status are called before any user
// is known) — same shape as authRateLimit, IP-keyed, guarding the same brute-force surface a
// short unauthenticated code otherwise invites (Phase8_BrowserExtension_Implementation_Plan.md
// §5.2).
export const pairingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
  skip,
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
  skip,
});
