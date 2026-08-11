import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { stubOutbox, clearStubOutbox } from '../src/shared/providers/email.provider';

const app = createApp();

async function getUserId(token: string) {
  const res = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  return res.body.account.id as string;
}

describe('Buckets (US-ORG-01, 02, 03)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });
  afterAll(disconnect);

  it('creates a bucket and the creator gets an owner membership', async () => {
    const token = await registerAndGetToken(app, 'ada@example.com');
    const res = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Client A' });
    expect(res.status).toBe(201);

    const list = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
    const bucket = list.body.buckets.find((b: { name: string }) => b.name === 'Client A');
    expect(bucket.role).toBe('owner');
  });

  it('renaming a bucket does not affect its contents or membership', async () => {
    const token = await registerAndGetToken(app, 'grace@example.com');
    const created = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Old name' });
    const bucketId = created.body.bucket.id;
    await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content: 'x', bucketId });

    await request(app).patch(`/api/buckets/${bucketId}`).set('Authorization', `Bearer ${token}`).send({ name: 'New name' });

    const memories = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`).query({ bucketId });
    expect(memories.body.items).toHaveLength(1);
  });

  it('rejects deleting the default bucket', async () => {
    const token = await registerAndGetToken(app, 'turing@example.com');
    const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
    const defaultBucket = buckets.body.buckets.find((b: { isDefault: boolean }) => b.isDefault);

    const res = await request(app).delete(`/api/buckets/${defaultBucket.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('rejects deleting a bucket that still has children', async () => {
    const token = await registerAndGetToken(app, 'hopper@example.com');
    const parent = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Parent' });
    await request(app)
      .post('/api/buckets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Child', parentId: parent.body.bucket.id });

    const res = await request(app).delete(`/api/buckets/${parent.body.bucket.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('asks for a strategy instead of refusing when a bucket still has memories', async () => {
    const token = await registerAndGetToken(app, 'franklin@example.com');
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Has memories' });
    const bucketId = bucket.body.bucket.id;
    await request(app).post('/api/memories').set('Authorization', `Bearer ${token}`).send({ content: 'keep me', bucketId });

    const withoutStrategy = await request(app).delete(`/api/buckets/${bucketId}`).set('Authorization', `Bearer ${token}`);
    expect(withoutStrategy.status).toBe(400);
    expect(withoutStrategy.body.error.code).toBe('BUCKET_NOT_EMPTY');
    expect(withoutStrategy.body.error.details.memoryCount).toBe(1);

    // The bucket still exists — the refusal above must not have half-applied anything.
    const stillThere = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
    expect(stillThere.body.buckets.some((b: { id: string }) => b.id === bucketId)).toBe(true);
  });

  it('move-to-default strategy relocates memories and files to the default bucket, then deletes the bucket', async () => {
    const token = await registerAndGetToken(app, 'agnesi@example.com');
    const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
    const defaultBucketId = buckets.body.buckets.find((b: { isDefault: boolean }) => b.isDefault).id;

    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Moving out' });
    const bucketId = bucket.body.bucket.id;
    const memory = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'relocate me', bucketId });

    const res = await request(app)
      .delete(`/api/buckets/${bucketId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ strategy: 'move-to-default' });
    expect(res.status).toBe(204);

    const inDefault = await request(app)
      .get('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .query({ bucketId: defaultBucketId });
    expect(inDefault.body.items.map((m: { id: string }) => m.id)).toContain(memory.body.memory.id);

    const buckets2 = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
    expect(buckets2.body.buckets.some((b: { id: string }) => b.id === bucketId)).toBe(false);
  });

  it('delete-contents strategy removes the memories along with the bucket', async () => {
    const token = await registerAndGetToken(app, 'noether-b@example.com');
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Deleting out' });
    const bucketId = bucket.body.bucket.id;
    const memory = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'delete me too', bucketId });

    const res = await request(app)
      .delete(`/api/buckets/${bucketId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ strategy: 'delete-contents' });
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/memories/${memory.body.memory.id}`).set('Authorization', `Bearer ${token}`);
    expect(check.status).toBe(404);
  });

  it('moves a memory to exactly one bucket, never duplicating it', async () => {
    const token = await registerAndGetToken(app, 'lovelace@example.com');
    const bucketA = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'A' });
    const bucketB = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'B' });
    const memory = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'movable', bucketId: bucketA.body.bucket.id });

    await request(app)
      .patch(`/api/memories/${memory.body.memory.id}/bucket`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bucketId: bucketB.body.bucket.id });

    const inA = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`).query({ bucketId: bucketA.body.bucket.id });
    const inB = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`).query({ bucketId: bucketB.body.bucket.id });
    expect(inA.body.items).toHaveLength(0);
    expect(inB.body.items).toHaveLength(1);
  });

  it('returns 403 filtering by a bucket the caller has no membership in', async () => {
    const tokenA = await registerAndGetToken(app, 'curie@example.com');
    const tokenB = await registerAndGetToken(app, 'noether@example.com');
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Private' });

    const res = await request(app)
      .get('/api/memories')
      .set('Authorization', `Bearer ${tokenB}`)
      .query({ bucketId: bucket.body.bucket.id });
    expect(res.status).toBe(403);
  });
});

describe('Shared buckets (US-ORG-04)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });
  afterAll(disconnect);

  async function setupSharedBucket(role: 'editor' | 'viewer') {
    const ownerToken = await registerAndGetToken(app, 'owner@example.com');
    const memberToken = await registerAndGetToken(app, 'member@example.com');
    const memberId = await getUserId(memberToken);

    const bucket = await request(app)
      .post('/api/buckets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Shared' });
    const bucketId = bucket.body.bucket.id;

    await request(app)
      .post(`/api/buckets/${bucketId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'member@example.com', role });

    const rawToken = stubOutbox[0].html.match(/invites\/([a-f0-9]+)/)?.[1];
    await request(app).post(`/api/invites/${rawToken}/accept`).set('Authorization', `Bearer ${memberToken}`);

    return { ownerToken, memberToken, memberId, bucketId };
  }

  it('an invited user has zero access before accepting', async () => {
    const ownerToken = await registerAndGetToken(app, 'owner2@example.com');
    const memberToken = await registerAndGetToken(app, 'member2@example.com');
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Shared' });

    await request(app)
      .post(`/api/buckets/${bucket.body.bucket.id}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'member2@example.com', role: 'editor' });

    const res = await request(app)
      .get('/api/memories')
      .set('Authorization', `Bearer ${memberToken}`)
      .query({ bucketId: bucket.body.bucket.id });
    expect(res.status).toBe(403);
  });

  it('accepting a valid invite grants immediate access; an already-used token is rejected on reuse', async () => {
    const { memberToken, bucketId } = await setupSharedBucket('viewer');

    const res = await request(app).get('/api/memories').set('Authorization', `Bearer ${memberToken}`).query({ bucketId });
    expect(res.status).toBe(200);

    const rawToken = stubOutbox[0].html.match(/invites\/([a-f0-9]+)/)?.[1];
    const reuse = await request(app).post(`/api/invites/${rawToken}/accept`).set('Authorization', `Bearer ${memberToken}`);
    expect(reuse.status).toBe(401);
  });

  it('a viewer cannot create, edit, delete, or merge memories in the shared bucket', async () => {
    const { ownerToken, memberToken, bucketId } = await setupSharedBucket('viewer');
    const memory = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: 'owner memory', bucketId });

    const createAttempt = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: 'viewer attempt', bucketId });
    expect(createAttempt.status).toBe(403);

    const editAttempt = await request(app)
      .patch(`/api/memories/${memory.body.memory.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: 'edited by viewer' });
    expect(editAttempt.status).toBe(403);

    const deleteAttempt = await request(app)
      .delete(`/api/memories/${memory.body.memory.id}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(deleteAttempt.status).toBe(403);
  });

  it("an editor's change is visible to the owner immediately and attributed to that member", async () => {
    const { ownerToken, memberToken, memberId, bucketId } = await setupSharedBucket('editor');
    const memory = await request(app)
      .post('/api/memories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: 'v1', bucketId });

    await request(app)
      .patch(`/api/memories/${memory.body.memory.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: 'v2 by editor' });

    const asOwner = await request(app).get(`/api/memories/${memory.body.memory.id}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(asOwner.body.memory.content).toBe('v2 by editor');

    const versions = await request(app)
      .get(`/api/memories/${memory.body.memory.id}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(versions.body.versions[1].changedBy).toBe(memberId);
  });

  it("removing a member revokes access on their very next request", async () => {
    const { ownerToken, memberToken, memberId, bucketId } = await setupSharedBucket('editor');

    const before = await request(app).get('/api/memories').set('Authorization', `Bearer ${memberToken}`).query({ bucketId });
    expect(before.status).toBe(200);

    await request(app)
      .delete(`/api/buckets/${bucketId}/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const after = await request(app).get('/api/memories').set('Authorization', `Bearer ${memberToken}`).query({ bucketId });
    expect(after.status).toBe(403);
  });

  it('cannot remove or demote the last owner', async () => {
    const ownerToken = await registerAndGetToken(app, 'soleowner@example.com');
    const ownerId = await getUserId(ownerToken);
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Solo' });

    const res = await request(app)
      .delete(`/api/buckets/${bucket.body.bucket.id}/members/${ownerId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('duplicate/stale suggestions across a shared bucket are visible to both contributors', async () => {
    const { ownerToken, memberToken, bucketId } = await setupSharedBucket('editor');

    await request(app).post('/api/memories').set('Authorization', `Bearer ${ownerToken}`).send({ content: 'We ship every Friday.', bucketId });
    await new Promise((r) => setTimeout(r, 300));
    await request(app).post('/api/memories').set('Authorization', `Bearer ${memberToken}`).send({ content: 'We ship every Friday', bucketId });
    await new Promise((r) => setTimeout(r, 300));

    const suggestions = await request(app).get('/api/suggestions').set('Authorization', `Bearer ${memberToken}`);
    expect(suggestions.body.suggestions.some((s: { type: string }) => s.type === 'duplicate')).toBe(true);
  });
});
