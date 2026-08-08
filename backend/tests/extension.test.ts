import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  return { token };
}

async function startPairing() {
  const res = await request(app).post('/api/extension/pairing/start');
  expect(res.status).toBe(201);
  return res.body.code as string;
}

describe('Extension pairing (US-ACC-03 extended)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('claims a pairing code exactly once — a second claim on the same code fails', async () => {
    const { token } = await seedAccount('ext-a@example.com');
    const code = await startPairing();

    const first = await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVALID_PAIRING_CODE');
  });

  it('rejects claiming an expired pairing code', async () => {
    const { token } = await seedAccount('ext-b@example.com');
    const code = await startPairing();
    await prisma.extensionPairingCode.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAIRING_CODE');
  });

  it('rejects a claim authorized by an API key instead of a session', async () => {
    const { token } = await seedAccount('ext-c@example.com');
    const keyRes = await request(app).post('/api/keys').set('Authorization', `Bearer ${token}`).send({ name: 'test key', scopes: [] });
    const rawKey = keyRes.body.apiKey.key as string;

    const code = await startPairing();
    const res = await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${rawKey}`).send({ code });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
  });

  it('delivers the key on the first status poll after a claim, and reports expired on every poll after that', async () => {
    const { token } = await seedAccount('ext-d@example.com');
    const code = await startPairing();

    const beforeClaim = await request(app).get(`/api/extension/pairing/status?code=${code}`);
    expect(beforeClaim.body.status).toBe('pending');

    await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code });

    const firstPoll = await request(app).get(`/api/extension/pairing/status?code=${code}`);
    expect(firstPoll.body.status).toBe('claimed');
    expect(typeof firstPoll.body.key).toBe('string');
    expect(firstPoll.body.key.startsWith('mp_')).toBe(true);

    const secondPoll = await request(app).get(`/api/extension/pairing/status?code=${code}`);
    expect(secondPoll.body.status).toBe('expired');
  });
});

describe('Scope enforcement (requireScope)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  async function pairExtensionKey(token: string): Promise<string> {
    const code = await startPairing();
    await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code });
    const poll = await request(app).get(`/api/extension/pairing/status?code=${code}`);
    return poll.body.key as string;
  }

  it('an extension-scoped key can save memories and preview context, but cannot mint further API keys', async () => {
    const { token } = await seedAccount('scope-a@example.com');
    const extensionKey = await pairExtensionKey(token);

    const saveRes = await request(app)
      .post('/api/memories/one-click')
      .set('Authorization', `Bearer ${extensionKey}`)
      .send({ content: 'Saved from the extension.' });
    expect(saveRes.status).toBe(201);

    const previewRes = await request(app)
      .post('/api/context/preview')
      .set('Authorization', `Bearer ${extensionKey}`)
      .send({ snippet: 'anything' });
    expect(previewRes.status).toBe(200);

    const mintRes = await request(app)
      .post('/api/keys')
      .set('Authorization', `Bearer ${extensionKey}`)
      .send({ name: 'a second key', scopes: [] });
    expect(mintRes.status).toBe(403);
    expect(mintRes.body.error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('a dashboard session is unaffected by scope enforcement — it can still mint API keys', async () => {
    const { token } = await seedAccount('scope-b@example.com');
    const res = await request(app).post('/api/keys').set('Authorization', `Bearer ${token}`).send({ name: 'dashboard key', scopes: [] });
    expect(res.status).toBe(201);
  });

  it('an extension-scoped key can still revoke (disconnect) itself via DELETE, unaffected by apikey:manage', async () => {
    const { token } = await seedAccount('scope-c@example.com');
    const code = await startPairing();
    const claim = await request(app).post('/api/extension/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code });
    const apiKeyId = claim.body.apiKeyId as string;
    const poll = await request(app).get(`/api/extension/pairing/status?code=${code}`);
    const extensionKey = poll.body.key as string;

    const res = await request(app).delete(`/api/keys/${apiKeyId}`).set('Authorization', `Bearer ${extensionKey}`);
    expect(res.status).toBe(200);

    const check = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    expect(check?.revokedAt).not.toBeNull();
  });
});
