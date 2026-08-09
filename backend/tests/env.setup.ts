process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ai_memory_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

// The suite's baseline is the PAID product: every pre-existing test asserts Pro gating, plan caps,
// and billing endpoints, and those must keep being exercised. The free-deployment behaviour is
// covered explicitly by tests/payments-flag.test.ts, which sets this per-block and rebuilds the
// app. Note the shipped default is the opposite (off/free) — see shared/env.ts for why.
process.env.PAYMENTS_ENABLED = 'true';
