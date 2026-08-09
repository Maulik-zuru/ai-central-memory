import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// US-SEC-01: "verified in deployment config — not merely asserted in a privacy page." Outside
// local development, a DATABASE_URL that doesn't require SSL is a misconfiguration the process
// should refuse to start on, rather than silently running unencrypted against a remote database.
// Local dev and CI talk to a loopback Postgres where TLS adds nothing, so they're exempt.
function assertDatabaseTls(url: string): string {
  if (process.env.NODE_ENV !== 'production') return url;

  const isLoopback = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const requiresSsl = /[?&]sslmode=(require|verify-ca|verify-full)/.test(url);
  if (!isLoopback && !requiresSsl) {
    throw new Error(
      'DATABASE_URL must set sslmode=require (or verify-ca/verify-full) in production — refusing ' +
        'to connect to a remote database without TLS. See docs/Phase11_Implementation_Plan.md §3.',
    );
  }
  return url;
}

/**
 * Master switch for the whole monetization layer.
 *
 * `PAYMENTS_ENABLED=true` runs the product as a paid Core/Pro service: plan gates apply, limits
 * are enforced, and the billing endpoints exist. Anything else — unset, empty, "false" — runs it
 * as a fully free product: every Pro feature is available to every account, no caps apply, and
 * the billing surface is not mounted at all.
 *
 * It defaults to OFF deliberately. A deployment that forgets to set it gives users too much
 * rather than locking paying customers out of features they can see; and a self-hosted or
 * internal instance, which is the common case for a tool like this, wants the free behaviour
 * without having to know the flag exists.
 */
function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  paymentsEnabled: readBool('PAYMENTS_ENABLED', false),
  databaseUrl: assertDatabaseTls(required('DATABASE_URL')),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
};
