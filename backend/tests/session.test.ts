import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, resetDb } from './testUtils';

const app = createApp();
const validUser = { email: 'turing@example.com', password: 'Str0ngPassw0rd' };

// One disconnect for the whole file, at top level: a per-describe afterAll(disconnect) tears down
// the Prisma connection as soon as the FIRST describe finishes, and every later describe in the
// file then fails with "Engine is not yet connected" (see tests/compliance.test.ts).
afterAll(disconnect);

describe('Sessions (US-ACC-08)', () => {
  beforeEach(resetDb);

  it('lists active sessions for the authenticated user', async () => {
    const register = await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app)
      .get('/api/account/sessions')
      .set('Authorization', `Bearer ${register.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
  });

  it('revoking a session invalidates its refresh token immediately', async () => {
    const register = await request(app).post('/api/auth/register').send(validUser);
    const cookie = register.headers['set-cookie'];

    const sessions = await request(app)
      .get('/api/account/sessions')
      .set('Authorization', `Bearer ${register.body.accessToken}`);
    const sessionId = sessions.body.sessions[0].id;

    const revoke = await request(app)
      .delete(`/api/account/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${register.body.accessToken}`);
    expect(revoke.status).toBe(204);

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(401);
  });
});

describe('Auto-capture consent (US-ACC-07)', () => {
  beforeEach(resetDb);

  it('persists per-platform consent toggles', async () => {
    const register = await request(app).post('/api/auth/register').send(validUser);
    const token = register.body.accessToken as string;

    const update = await request(app)
      .patch('/api/account/auto-capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ autoCapture: { chatgpt: false, claude: true } });
    expect(update.status).toBe(200);

    const me = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.account.autoCapture).toEqual({ chatgpt: false, claude: true });
  });
});
