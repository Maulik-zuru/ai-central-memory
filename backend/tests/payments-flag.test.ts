import request from 'supertest';
import type { Express } from 'express';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';

/**
 * PAYMENTS_ENABLED is read at module load (shared/env.ts), so each mode needs the module registry
 * reset and the app rebuilt with the flag already set. jest.isolateModulesAsync gives each block
 * its own copy of env/entitlements/app.
 */
async function appWithPayments(enabled: boolean): Promise<Express> {
  process.env.PAYMENTS_ENABLED = enabled ? 'true' : 'false';
  jest.resetModules();
  const { createApp } = await import('../src/app');
  return createApp();
}

const originalFlag = process.env.PAYMENTS_ENABLED;
afterAll(async () => {
  process.env.PAYMENTS_ENABLED = originalFlag;
  await disconnect();
});

describe('PAYMENTS_ENABLED=false — everything is free', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDb();
    app = await appWithPayments(false);
  });

  it('reports the account as fully entitled with no trial', async () => {
    const token = await registerAndGetToken(app, 'free-a@example.com');
    const res = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.account.paymentsEnabled).toBe(false);
    expect(res.body.account.subscription).toEqual({ plan: 'pro', status: 'active', trialEndsAt: null });
  });

  it('opens every Pro-gated endpoint to a plain account', async () => {
    const token = await registerAndGetToken(app, 'free-b@example.com');

    for (const path of [
      '/api/intelligence/graph',
      '/api/intelligence/usage',
      '/api/intelligence/insights',
      '/api/chat-history/insights',
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect([path, res.status]).toEqual([path, 200]);
    }
  });

  it('lifts the conversation cap entirely', async () => {
    const token = await registerAndGetToken(app, 'free-c@example.com');
    const usage = await request(app).get('/api/chat-history/usage').set('Authorization', `Bearer ${token}`);

    expect(usage.status).toBe(200);
    expect(usage.body.limit).toBeNull(); // null = unlimited
  });

  it('allows category renaming, which is Pro-gated when payments are on', async () => {
    const token = await registerAndGetToken(app, 'free-d@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    const category = await prisma.category.create({
      data: { userId: account.body.account.id, label: 'Original', memoryCount: 1 },
    });

    const res = await request(app)
      .patch(`/api/categories/${category.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Renamed' });

    expect(res.status).toBe(200);
  });

  it('404s checkout and portal — there is nothing to sell', async () => {
    const token = await registerAndGetToken(app, 'free-e@example.com');

    const checkout = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
    expect(checkout.status).toBe(404);

    const portal = await request(app).post('/api/billing/portal').set('Authorization', `Bearer ${token}`);
    expect(portal.status).toBe(404);

    const webhook = await request(app).post('/api/billing/webhook').set('stripe-signature', 'x').send({ id: 'e1' });
    expect(webhook.status).toBe(404);
  });

  it('still serves the billing summary, so the UI can learn to hide itself', async () => {
    const token = await registerAndGetToken(app, 'free-f@example.com');
    const res = await request(app).get('/api/billing/summary').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.paymentsEnabled).toBe(false);
    expect(res.body.plan).toBe('pro');
    expect(res.body.history.limit).toBeNull();
  });

  it('runs the knowledge-graph job for ordinary accounts, not just paying ones', async () => {
    const token = await registerAndGetToken(app, 'free-g@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);

    await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'We are building Project Halo for Client Vertex.' });

    const { graphService } = await import('../src/modules/intelligence/graph.service');
    await graphService.runBatch(50);

    const nodes = await prisma.knowledgeGraphNode.count({ where: { userId: account.body.account.id } });
    expect(nodes).toBeGreaterThan(0);
  });
});

describe('PAYMENTS_ENABLED=true — the paid product behaves exactly as before', () => {
  let app: Express;

  beforeEach(async () => {
    await resetDb();
    app = await appWithPayments(true);
  });

  it('reports the real Core subscription and the flag', async () => {
    const token = await registerAndGetToken(app, 'paid-a@example.com');
    const res = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);

    expect(res.body.account.paymentsEnabled).toBe(true);
    expect(res.body.account.subscription.plan).toBe('core');
  });

  it('still blocks Pro-gated endpoints for a Core account', async () => {
    const token = await registerAndGetToken(app, 'paid-b@example.com');

    for (const path of ['/api/intelligence/graph', '/api/chat-history/insights']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRO_FEATURE');
    }
  });

  it('still applies the Core conversation cap', async () => {
    const token = await registerAndGetToken(app, 'paid-c@example.com');
    const usage = await request(app).get('/api/chat-history/usage').set('Authorization', `Bearer ${token}`);
    expect(usage.body.limit).toBe(500);
  });

  it('still exposes checkout and portal', async () => {
    const token = await registerAndGetToken(app, 'paid-d@example.com');

    const checkout = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toBeDefined();
  });

  it('unlocks the same endpoints once the account is actually Pro', async () => {
    const token = await registerAndGetToken(app, 'paid-e@example.com');
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    await prisma.subscription.update({
      where: { userId: account.body.account.id },
      data: { plan: 'pro' },
    });

    const res = await request(app).get('/api/intelligence/graph').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
