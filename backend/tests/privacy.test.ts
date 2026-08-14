import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';

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

    // Distinct snippets per platform (rather than the identical text both used to share) so each
    // one's presence/absence among suggestions is directly attributable to its own request, not
    // muddied by the capture pipeline's own draftContent dedup.
    const disabledSnippet = 'We deploy side projects to Railway now — chatgpt attempt.';
    const enabledSnippet = 'We deploy side projects to Railway now — claude attempt.';

    const disabled = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: disabledSnippet, platform: 'chatgpt' });
    expect(disabled.status).toBe(202);

    const stillEnabled = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: enabledSnippet, platform: 'claude' });
    expect(stillEnabled.status).toBe(202);

    // Wait for the enabled platform's suggestion to land — proof the fire-and-forget pipeline had
    // time to run for both requests — then confirm the disabled one never produced its own.
    const suggestions = await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) =>
          res.body.suggestions.some((s: { draftContent: string | null }) => s.draftContent === enabledSnippet)
            ? (res.body.suggestions as { draftContent: string | null }[])
            : undefined,
        ),
    );
    expect(suggestions.some((s) => s.draftContent === disabledSnippet)).toBe(false);
  });

  it('treats an unset platform as enabled, so consent defaults to the pre-Phase-11 behaviour', async () => {
    const token = await registerAndGetToken(app, 'consent-b@example.com');

    const res = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'We ship every Friday afternoon.', platform: 'gemini' });

    expect(res.status).toBe(202);

    const suggestions = await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => (res.body.suggestions.length > 0 ? res.body.suggestions : undefined)),
    );
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('disabling capture does not delete suggestions that already exist (US-ACC-07 AC)', async () => {
    const token = await registerAndGetToken(app, 'consent-c@example.com');

    await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'The launch date moved to next Friday.', platform: 'chatgpt' });

    await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => (res.body.suggestions.length > 0 ? res.body.suggestions : undefined)),
    );

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
