import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';

const app = createApp();

// One disconnect for the whole file — see the note in compliance.test.ts.
afterAll(disconnect);

describe('Phase 11: auto-capture consent enforcement (US-ACC-07)', () => {
  beforeEach(resetDb);

  it('stops suggestions for a disabled platform while leaving other platforms working', async () => {
    const token = await registerAndGetToken(app, 'consent-a@example.com');

    await request(app)
      .patch('/api/account/auto-capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ autoCapture: { chatgpt: false } });

    const disabled = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'We deploy side projects to Railway now.', platform: 'chatgpt' });
    expect(disabled.status).toBe(201);
    expect(disabled.body.suggestions).toHaveLength(0);

    const stillEnabled = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'We deploy side projects to Railway now.', platform: 'claude' });
    expect(stillEnabled.status).toBe(201);
    expect(stillEnabled.body.suggestions.length).toBeGreaterThan(0);
  });

  it('treats an unset platform as enabled, so consent defaults to the pre-Phase-11 behaviour', async () => {
    const token = await registerAndGetToken(app, 'consent-b@example.com');

    const res = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'We ship every Friday afternoon.', platform: 'gemini' });

    expect(res.status).toBe(201);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  it('disabling capture does not delete suggestions that already exist (US-ACC-07 AC)', async () => {
    const token = await registerAndGetToken(app, 'consent-c@example.com');

    await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'The launch date moved to next Friday.', platform: 'chatgpt' });

    await request(app)
      .patch('/api/account/auto-capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ autoCapture: { chatgpt: false } });

    const suggestions = await request(app).get('/api/suggestions').set('Authorization', `Bearer ${token}`);
    expect(suggestions.body.suggestions.length).toBeGreaterThan(0);
  });
});

describe('Phase 11: revoke all other sessions (US-ACC-08)', () => {
  beforeEach(resetDb);

  const credentials = { email: 'multi-device@example.com', password: 'Str0ngPassw0rd' };

  it('invalidates every other device within the request cycle while keeping the caller signed in', async () => {
    const first = await request(app).post('/api/auth/register').send(credentials);
    const second = await request(app).post('/api/auth/login').send(credentials);
    const third = await request(app).post('/api/auth/login').send(credentials);

    const before = await request(app)
      .get('/api/account/sessions')
      .set('Authorization', `Bearer ${first.body.accessToken}`);
    expect(before.body.sessions).toHaveLength(3);

    const revoked = await request(app)
      .post('/api/account/sessions/revoke-others')
      .set('Authorization', `Bearer ${first.body.accessToken}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedCount).toBe(2);

    // The other devices' refresh tokens must fail on their very next use — no grace period.
    for (const other of [second, third]) {
      const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', other.headers['set-cookie']);
      expect(refreshed.status).toBe(401);
    }

    // ...and the caller's own session survives.
    const stillValid = await request(app).post('/api/auth/refresh').set('Cookie', first.headers['set-cookie']);
    expect(stillValid.status).toBe(200);

    // Refresh ROTATES (auth.service.refresh revokes the old row and issues a new one), so the
    // caller continues with the access token that refresh just returned — as any real client does,
    // since authenticate() rejects a token whose session has been rotated away. Exactly one
    // session is live afterwards: the rotated-in one.
    const after = await request(app)
      .get('/api/account/sessions')
      .set('Authorization', `Bearer ${stillValid.body.accessToken}`);
    expect(after.status).toBe(200);
    expect(after.body.sessions).toHaveLength(1);
  });

  it('never touches another account&apos;s sessions', async () => {
    await request(app).post('/api/auth/register').send(credentials);
    const other = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bystander@example.com', password: 'Str0ngPassw0rd' });

    const mine = await request(app).post('/api/auth/login').send(credentials);
    await request(app)
      .post('/api/account/sessions/revoke-others')
      .set('Authorization', `Bearer ${mine.body.accessToken}`);

    const bystanderSessions = await request(app)
      .get('/api/account/sessions')
      .set('Authorization', `Bearer ${other.body.accessToken}`);
    expect(bystanderSessions.body.sessions).toHaveLength(1);
  });
});
