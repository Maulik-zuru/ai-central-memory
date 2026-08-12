import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

async function createMemory(token: string, content: string, bucketId?: string) {
  const res = await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content, bucketId });
  return res.body.memory.id as string;
}

describe('Bulk memory operations (US-INT-06)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('bulk-deletes accessible memories and reports failures for the rest, without aborting the batch', async () => {
    const { token } = await seedAccount('turing-bulk@example.com');
    const { token: outsiderToken } = await seedAccount('outsider-bulk@example.com');

    const idA = await createMemory(token, 'keep track of A');
    const idB = await createMemory(token, 'keep track of B');
    const notMine = await createMemory(outsiderToken, "someone else's memory");

    const res = await request(app)
      .post('/api/memories/bulk-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ memoryIds: [idA, idB, notMine, 'does-not-exist'] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    expect(res.body.failed).toEqual(expect.arrayContaining([notMine, 'does-not-exist']));

    const checkA = await request(app).get(`/api/memories/${idA}`).set('Authorization', `Bearer ${token}`);
    expect(checkA.status).toBe(404);

    // The memory a different account owns must be completely unaffected by this call.
    const checkOther = await request(app).get(`/api/memories/${notMine}`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(checkOther.status).toBe(200);
  });
});

describe('Versioned memory API — GET/POST /api/v2/memory (US-INT-06)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('returns memories and buckets in one call, filterable by bucket and content type', async () => {
    const { token, bucketId } = await seedAccount('lovelace-v2@example.com');
    const other = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Other' });
    const otherBucketId = other.body.bucket.id;

    await createMemory(token, 'in default bucket', bucketId);
    await createMemory(token, 'in other bucket', otherBucketId);

    const all = await request(app).get('/api/v2/memory').set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.memories.length).toBe(2);
    expect(all.body.buckets.length).toBeGreaterThanOrEqual(2);

    const scoped = await request(app)
      .get('/api/v2/memory')
      .set('Authorization', `Bearer ${token}`)
      .query({ bucketId: otherBucketId });
    expect(scoped.body.memories).toHaveLength(1);
    expect(scoped.body.memories[0].content).toBe('in other bucket');
  });

  it('single-memory update: edits text and moves to a bucket named by string, in one call', async () => {
    const { token } = await seedAccount('hopper-v2@example.com');
    const targetBucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Renamed target' });
    const memoryId = await createMemory(token, 'original text');

    const res = await request(app)
      .post('/api/v2/memory/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ memoryId, text: 'edited text', bucketName: 'Renamed target' });

    expect(res.status).toBe(200);
    expect(res.body.memory.content).toBe('edited text');
    expect(res.body.memory.bucketId).toBe(targetBucket.body.bucket.id);
  });

  it('bulk update is move-only and all-or-nothing — one unresolvable id moves zero memories', async () => {
    const { token } = await seedAccount('agnesi-v2@example.com');
    const { token: outsiderToken } = await seedAccount('outsider-v2@example.com');
    const target = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Bulk target' });

    const idA = await createMemory(token, 'bulk A');
    const idB = await createMemory(token, 'bulk B');
    const notMine = await createMemory(outsiderToken, 'not yours');

    const rejected = await request(app)
      .post('/api/v2/memory/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ memoryIds: [idA, idB, notMine], bucketId: target.body.bucket.id });
    expect(rejected.status).toBe(404);
    expect(rejected.body.error.details.rejectedIds).toEqual([notMine]);

    // Nothing moved — all-or-nothing means the two valid IDs were not moved either.
    const stillA = await request(app).get(`/api/memories/${idA}`).set('Authorization', `Bearer ${token}`);
    expect(stillA.body.memory.bucketId).not.toBe(target.body.bucket.id);

    const accepted = await request(app)
      .post('/api/v2/memory/update')
      .set('Authorization', `Bearer ${token}`)
      .send({ memoryIds: [idA, idB], bucketId: target.body.bucket.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.movedCount).toBe(2);
  });
});
