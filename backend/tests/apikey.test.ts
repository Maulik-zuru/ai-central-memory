import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, resetDb } from './testUtils';

const app = createApp();
const validUser = { email: 'grace@example.com', password: 'Str0ngPassw0rd' };

async function registerAndGetToken() {
  const res = await request(app).post('/api/auth/register').send(validUser);
  return res.body.accessToken as string;
}

describe('API keys (US-ACC-03)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('issues a key, returning the raw key exactly once', async () => {
    const token = await registerAndGetToken();
    const res = await request(app)
      .post('/api/keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CI pipeline' });

    expect(res.status).toBe(201);
    expect(res.body.apiKey.key).toMatch(/^mp_/);
    expect(res.body.apiKey.name).toBe('CI pipeline');
  });

  it('never returns the raw key again from the list endpoint', async () => {
    const token = await registerAndGetToken();
    await request(app).post('/api/keys').set('Authorization', `Bearer ${token}`).send({ name: 'Key A' });

    const list = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.apiKeys).toHaveLength(1);
    expect(list.body.apiKeys[0]).not.toHaveProperty('key');
    expect(list.body.apiKeys[0]).not.toHaveProperty('keyHash');
    expect(list.body.apiKeys[0].preview).toMatch(/^mp_.+….+$/);
  });

  it('authenticates a protected endpoint using a freshly issued API key', async () => {
    const token = await registerAndGetToken();
    const issued = await request(app)
      .post('/api/keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Integration key' });

    const res = await request(app)
      .get('/api/account/me')
      .set('Authorization', `Bearer ${issued.body.apiKey.key}`);

    expect(res.status).toBe(200);
  });

  it('fails auth immediately on the very next request after revocation', async () => {
    const token = await registerAndGetToken();
    const issued = await request(app)
      .post('/api/keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soon revoked' });
    const rawKey = issued.body.apiKey.key as string;

    const before = await request(app).get('/api/account/me').set('Authorization', `Bearer ${rawKey}`);
    expect(before.status).toBe(200);

    await request(app).delete(`/api/keys/${issued.body.apiKey.id}`).set('Authorization', `Bearer ${token}`);

    const after = await request(app).get('/api/account/me').set('Authorization', `Bearer ${rawKey}`);
    expect(after.status).toBe(401);
  });

  it("cannot revoke another user's key", async () => {
    const tokenA = await registerAndGetToken();
    const issued = await request(app)
      .post('/api/keys')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: "Alice's key" });

    const registerB = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bob@example.com', password: 'Str0ngPassw0rd' });
    const tokenB = registerB.body.accessToken as string;

    const res = await request(app)
      .delete(`/api/keys/${issued.body.apiKey.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });
});
