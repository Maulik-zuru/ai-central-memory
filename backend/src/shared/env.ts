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

export const env = {
  port: Number(process.env.PORT ?? 4000),
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
