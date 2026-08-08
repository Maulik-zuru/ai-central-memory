import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, resetDb } from './testUtils';

const app = createApp();

const validUser = { email: 'ada@example.com', password: 'Str0ngPassw0rd' };

describe('Auth (US-ACC-01)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('registers a new user and returns an access token + user object', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(validUser.email);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.headers['set-cookie']?.[0]).toMatch(/refreshToken=/);
  });

  it('scopes the refresh cookie to Path=/ so the frontend proxy can read it on any route', async () => {
    // Regression guard: a narrower path (e.g. /api/auth) is invisible to requests the browser
    // makes to the frontend's own routes, breaking the optimistic auth check in proxy.ts.
    const res = await request(app).post('/api/auth/register').send(validUser);
    expect(res.headers['set-cookie']?.[0]).toMatch(/Path=\//);
  });

  it('rejects a weak password before touching the database', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x@example.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('does not reveal whether an email is already registered', async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.status).toBe(409);
    expect(res.body.error.message.toLowerCase()).not.toContain('already');
    expect(res.body.error.message.toLowerCase()).not.toContain('exists');
  });

  it('logs in with correct credentials', async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app).post('/api/auth/login').send(validUser);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('fails login with a clear but generic error for wrong credentials, without revealing whether the email exists', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ ...validUser, password: 'WrongPassword1' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPassword1' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('authenticates a protected endpoint using the session access token', async () => {
    const register = await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app)
      .get('/api/account/me')
      .set('Authorization', `Bearer ${register.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.account.email).toBe(validUser.email);
  });

  it('rotates the refresh token and rejects the old one after refresh', async () => {
    const register = await request(app).post('/api/auth/register').send(validUser);
    const cookie = register.headers['set-cookie'];

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);

    const reuseOld = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(reuseOld.status).toBe(401);
  });

  it('logging out revokes the session so refresh no longer works', async () => {
    const register = await request(app).post('/api/auth/register').send(validUser);
    const cookie = register.headers['set-cookie'];

    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);

    expect(refreshed.status).toBe(401);
  });

  it('records an audit log entry for register and login', async () => {
    const { prisma } = await import('../src/shared/prisma');
    const register = await request(app).post('/api/auth/register').send(validUser);
    await request(app).post('/api/auth/login').send(validUser);

    const logs = await prisma.auditLog.findMany({ where: { userId: register.body.user.id } });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('user.register');
    expect(actions).toContain('user.login');
  });
});
