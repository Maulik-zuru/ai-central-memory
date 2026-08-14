import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { DESKTOP_AGENT_SCOPES } from '../src/modules/desktop/desktop.service';

// Phase 13 (US-INT-07). Acceptance criteria as tests, per
// docs/Phase13_DesktopAgent_Implementation_Plan.md §6.4.
const app = createApp();

async function startDesktopPairing() {
  const res = await request(app).post('/api/desktop/pairing/start');
  expect(res.status).toBe(201);
  return res.body.code as string;
}

const DEVICE = {
  deviceName: "Maulik's MacBook Pro",
  platform: 'darwin',
  osVersion: '15.2',
  appVersion: '1.0.0',
};

async function pairDevice(token: string) {
  const code = await startDesktopPairing();
  const claim = await request(app)
    .post('/api/desktop/pairing/claim')
    .set('Authorization', `Bearer ${token}`)
    .send({ code, ...DEVICE });
  expect(claim.status).toBe(200);
  const poll = await request(app).get(`/api/desktop/pairing/status?code=${code}`);
  return { key: poll.body.key as string, deviceId: claim.body.deviceId as string, apiKeyId: claim.body.apiKeyId as string };
}

describe('Desktop agent pairing (US-INT-07)', () => {
  beforeEach(resetDb);

  it('claiming a code creates exactly one device and one scoped key, and that key cannot mint keys', async () => {
    const token = await registerAndGetToken(app, 'desk-a@example.com');
    const { key, deviceId } = await pairDevice(token);

    const devices = await prisma.desktopAgentDevice.findMany();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe(deviceId);
    expect(devices[0].name).toBe(DEVICE.deviceName);
    expect(devices[0].platform).toBe('darwin');

    const apiKey = await prisma.apiKey.findUnique({ where: { id: devices[0].apiKeyId! } });
    expect(apiKey?.scopes.sort()).toEqual([...DESKTOP_AGENT_SCOPES].sort());
    expect(apiKey?.scopes).not.toContain('apikey:manage');

    const mint = await request(app).post('/api/keys').set('Authorization', `Bearer ${key}`).send({ name: 'x', scopes: [] });
    expect(mint.status).toBe(403);
    expect(mint.body.error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('delivers the key on the first status poll only', async () => {
    const token = await registerAndGetToken(app, 'desk-b@example.com');
    const code = await startDesktopPairing();

    expect((await request(app).get(`/api/desktop/pairing/status?code=${code}`)).body.status).toBe('pending');

    await request(app).post('/api/desktop/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code, ...DEVICE });

    const first = await request(app).get(`/api/desktop/pairing/status?code=${code}`);
    expect(first.body.status).toBe('claimed');
    expect(first.body.key.startsWith('mp_')).toBe(true);

    const second = await request(app).get(`/api/desktop/pairing/status?code=${code}`);
    expect(second.body.status).toBe('expired');
    expect(second.body.key).toBeUndefined();
  });

  it('rejects an expired pairing code', async () => {
    const token = await registerAndGetToken(app, 'desk-c@example.com');
    const code = await startDesktopPairing();
    await prisma.devicePairingCode.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post('/api/desktop/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code, ...DEVICE });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAIRING_CODE');
  });

  // The generalization of the pairing table must not create a cross-client confusion path: a
  // desktop code must never yield an extension-scoped key, or vice versa.
  it('a desktop code cannot be claimed through the extension endpoint, and vice versa', async () => {
    const token = await registerAndGetToken(app, 'desk-d@example.com');

    const desktopCode = await startDesktopPairing();
    const wrong = await request(app)
      .post('/api/extension/pairing/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: desktopCode });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_PAIRING_CODE');

    const extCode = (await request(app).post('/api/extension/pairing/start')).body.code as string;
    const wrongOther = await request(app)
      .post('/api/desktop/pairing/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: extCode, ...DEVICE });
    expect(wrongOther.status).toBe(400);

    // ...and a desktop code polled on the extension's status endpoint never hands over a key.
    await request(app).post('/api/desktop/pairing/claim').set('Authorization', `Bearer ${token}`).send({ code: desktopCode, ...DEVICE });
    const crossPoll = await request(app).get(`/api/extension/pairing/status?code=${desktopCode}`);
    expect(crossPoll.body.status).toBe('expired');
    expect(crossPoll.body.key).toBeUndefined();
  });

  it('requires a session to claim — an API key is not enough', async () => {
    const token = await registerAndGetToken(app, 'desk-e@example.com');
    const keyRes = await request(app).post('/api/keys').set('Authorization', `Bearer ${token}`).send({ name: 'k', scopes: [] });
    const rawKey = keyRes.body.apiKey.key as string;

    const code = await startDesktopPairing();
    const res = await request(app).post('/api/desktop/pairing/claim').set('Authorization', `Bearer ${rawKey}`).send({ code, ...DEVICE });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
  });
});

describe('Desktop device registry', () => {
  beforeEach(resetDb);

  it('lists paired devices for the owning account', async () => {
    const token = await registerAndGetToken(app, 'reg-a@example.com');
    await pairDevice(token);

    const res = await request(app).get('/api/desktop/devices').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].name).toBe(DEVICE.deviceName);
    expect(res.body.devices[0].revoked).toBe(false);
  });

  it('revoking a device kills its key — the agent 401s on its very next capture', async () => {
    const token = await registerAndGetToken(app, 'reg-b@example.com');
    const { key, deviceId } = await pairDevice(token);

    const before = await request(app).post('/api/capture').set('Authorization', `Bearer ${key}`).send({ snippet: 'I use pnpm.' });
    expect(before.status).toBe(202);

    const revoke = await request(app).delete(`/api/desktop/devices/${deviceId}`).set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(200);

    const after = await request(app).post('/api/capture').set('Authorization', `Bearer ${key}`).send({ snippet: 'I use npm.' });
    expect(after.status).toBe(401);
  });

  it("revoking another account's device returns 404, not 403 — no existence leak", async () => {
    const owner = await registerAndGetToken(app, 'reg-c@example.com');
    const stranger = await registerAndGetToken(app, 'reg-d@example.com');
    const { deviceId } = await pairDevice(owner);

    const res = await request(app).delete(`/api/desktop/devices/${deviceId}`).set('Authorization', `Bearer ${stranger}`);
    expect(res.status).toBe(404);
  });

  it('revoking a device requires a session, not a key — including the device\'s own key', async () => {
    const token = await registerAndGetToken(app, 'reg-e@example.com');
    const { key, deviceId } = await pairDevice(token);

    const res = await request(app).delete(`/api/desktop/devices/${deviceId}`).set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
  });

  it('heartbeat stamps lastSeenAt and is idempotent', async () => {
    const token = await registerAndGetToken(app, 'reg-f@example.com');
    const { key, deviceId } = await pairDevice(token);

    const first = await request(app).post('/api/desktop/heartbeat').set('Authorization', `Bearer ${key}`).send({ appVersion: '1.0.1' });
    expect(first.status).toBe(200);
    const afterFirst = await prisma.desktopAgentDevice.findUnique({ where: { id: deviceId } });
    expect(afterFirst?.lastSeenAt).not.toBeNull();
    expect(afterFirst?.appVersion).toBe('1.0.1');

    const second = await request(app).post('/api/desktop/heartbeat').set('Authorization', `Bearer ${key}`).send({ appVersion: '1.0.1' });
    expect(second.status).toBe(200);
    expect(await prisma.desktopAgentDevice.count()).toBe(1);
  });
});

describe('Desktop capture consent (US-ACC-07 reused, not re-implemented)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('captures from claude-code when consent is unset, and captures nothing when it is off', async () => {
    const token = await registerAndGetToken(app, 'cons-a@example.com');
    const { key } = await pairDevice(token);

    const allowed = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${key}`)
      .send({ snippet: 'I always run tests with vitest.', platform: 'claude-code' });
    expect(allowed.status).toBe(202);

    const suggestions = await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => (res.body.suggestions.length > 0 ? res.body.suggestions : undefined)),
    );
    expect(suggestions.length).toBeGreaterThan(0);

    await request(app)
      .patch('/api/account/auto-capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ autoCapture: { 'claude-code': false } });

    const blocked = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${key}`)
      .send({ snippet: 'I deploy on Fridays.', platform: 'claude-code' });
    expect(blocked.status).toBe(202);

    // Give the fire-and-forget pipeline a moment, then confirm the count never grows past what
    // the first (allowed) capture already produced — the toggle blocked this one before extraction.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await request(app).get('/api/suggestions').set('Authorization', `Bearer ${token}`);
    expect(after.body.suggestions).toHaveLength(suggestions.length);
  });
});
