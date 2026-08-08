import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { healthService } from '../src/modules/ops/health.service';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

describe('Phase 12: ops health metrics', () => {
  const originalOpsKey = process.env.OPS_API_KEY;

  beforeEach(resetDb);
  afterAll(async () => {
    process.env.OPS_API_KEY = originalOpsKey;
    await disconnect();
  });

  it('reports a sync failure rate computed from real conversation status', async () => {
    const { userId, bucketId } = await seedAccount('ops-a@example.com');

    await prisma.conversation.createMany({
      data: [
        { userId, bucketId, platform: 'chatgpt', contentHash: 'h1', title: 'ok one', status: 'ready' },
        { userId, bucketId, platform: 'chatgpt', contentHash: 'h2', title: 'ok two', status: 'ready' },
        { userId, bucketId, platform: 'chatgpt', contentHash: 'h3', title: 'broken', status: 'error', errorReason: 'boom' },
      ],
    });

    const health = await healthService.syncFailureRate(24);
    expect(health.total).toBe(3);
    expect(health.failed).toBe(1);
    expect(health.rate).toBeCloseTo(1 / 3, 5);
  });

  it('reports zero — not NaN — when nothing has synced at all', async () => {
    const health = await healthService.syncFailureRate(24);
    expect(health.total).toBe(0);
    expect(health.rate).toBe(0);
  });

  it('surfaces an embedding backlog only for rows that are actually stale', async () => {
    const { userId, bucketId } = await seedAccount('ops-b@example.com');

    // Fresh and unembedded: expected, mid-pipeline, not a backlog.
    await prisma.memory.create({
      data: { userId, bucketId, type: 'text', content: 'just created', source: 'manual' },
    });
    const fresh = await healthService.embeddingBacklog();
    expect(fresh.stale).toBe(0);

    // Backdated past the threshold: the fire-and-forget chain never finished, which is the
    // condition this metric exists to catch before a user notices missing search results.
    await prisma.memory.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const stale = await healthService.embeddingBacklog();
    expect(stale.stale).toBe(1);
    expect(stale.oldestAgeSeconds).toBeGreaterThan(600);
  });

  it('404s the ops endpoint entirely when no OPS_API_KEY is configured', async () => {
    delete process.env.OPS_API_KEY;
    const res = await request(app).get('/api/ops/health');
    expect(res.status).toBe(404);
  });

  it('401s without the ops key and serves metrics with it — never on a normal user session', async () => {
    process.env.OPS_API_KEY = 'test-ops-key';
    const { token } = await seedAccount('ops-c@example.com');

    const anonymous = await request(app).get('/api/ops/health');
    expect(anonymous.status).toBe(401);

    // A perfectly valid *user* session must not reach ops metrics — this is not a customer surface.
    const asUser = await request(app).get('/api/ops/health').set('Authorization', `Bearer ${token}`);
    expect(asUser.status).toBe(401);

    const wrongKey = await request(app).get('/api/ops/health').set('x-ops-key', 'not-the-key');
    expect(wrongKey.status).toBe(401);

    const authorized = await request(app).get('/api/ops/health').set('x-ops-key', 'test-ops-key');
    expect(authorized.status).toBe(200);
    expect(authorized.body.sync).toBeDefined();
    expect(authorized.body.embeddings).toBeDefined();
    expect(authorized.body.database).toBe('ok');
  });
});
