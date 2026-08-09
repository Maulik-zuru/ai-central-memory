import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, resetDb } from './testUtils';
import { __setRateLimitEnabledForTests } from '../src/shared/rateLimit';

const app = createApp();
afterAll(disconnect);

/**
 * Rate limiting is bypassed for the rest of the suite (see rateLimit.ts: every test shares one
 * loopback IP, so IP-keyed limits would fire partway through an unrelated suite and surface as
 * confusing downstream failures). That bypass would otherwise leave a security control with zero
 * coverage — so this file turns it back on and proves the limiters actually reject.
 */
describe('Rate limiting', () => {
  beforeEach(async () => {
    await resetDb();
    __setRateLimitEnabledForTests(true);
  });
  afterEach(() => __setRateLimitEnabledForTests(false));

  it('rejects with 429 once the auth limit is crossed, and says why', async () => {
    let sawRateLimited = false;
    let lastBody: unknown;

    // authRateLimit allows 20 per 15 minutes per IP; well past it in one burst.
    for (let i = 0; i < 40; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: `burst${i}@example.com`, password: 'wrong-password' });
      if (res.status === 429) {
        sawRateLimited = true;
        lastBody = res.body;
        break;
      }
    }

    expect(sawRateLimited).toBe(true);
    // A generic 429 with no code is hard for a client to distinguish from any other failure.
    expect(lastBody).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('is genuinely off for the rest of the suite, so unrelated tests never see a 429', async () => {
    __setRateLimitEnabledForTests(false);

    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: `unlimited${i}@example.com`, password: 'wrong-password' });
      // 401 (bad credentials) is the expected answer here — never 429.
      expect(res.status).toBe(401);
    }
  });
});
