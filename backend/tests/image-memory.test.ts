import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { stubOutbox, clearStubOutbox } from '../src/shared/providers/email.provider';

const app = createApp();

// A minimal valid 1x1 PNG, used only to exercise the upload pipeline end-to-end.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Image memories (US-MEM-05)', () => {
  beforeEach(async () => {
    await resetDb();
    clearStubOutbox();
  });
  afterAll(disconnect);

  it('uploads an image and it appears in the memory list with a thumbnail URL', async () => {
    const token = await registerAndGetToken(app, 'ada@example.com');
    const res = await request(app)
      .post('/api/memories/image')
      .set('Authorization', `Bearer ${token}`)
      .field('caption', 'Roadmap whiteboard, March planning session')
      .attach('image', PNG_1X1, { filename: 'whiteboard.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.memory.type).toBe('image');
    expect(res.body.memory.imageUrl).toMatch(/^\/uploads\//);

    const list = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].imageUrl).toBe(res.body.memory.imageUrl);
  });

  it('rejects a non-image file', async () => {
    const token = await registerAndGetToken(app, 'grace@example.com');
    const res = await request(app)
      .post('/api/memories/image')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('not an image'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
  });

  it('rejects an image memory in a bucket that is actually shared with another member', async () => {
    const ownerToken = await registerAndGetToken(app, 'hopper-img@example.com');
    const collaboratorToken = await registerAndGetToken(app, 'lovelace-img@example.com');

    const bucket = await request(app)
      .post('/api/buckets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Shared with a collaborator' });
    const bucketId = bucket.body.bucket.id;

    await request(app)
      .post(`/api/buckets/${bucketId}/invites`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'lovelace-img@example.com', role: 'editor' });
    const rawToken = stubOutbox[0].html.match(/invites\/([a-f0-9]+)/)?.[1];
    await request(app).post(`/api/invites/${rawToken}/accept`).set('Authorization', `Bearer ${collaboratorToken}`);

    const res = await request(app)
      .post('/api/memories/image')
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('bucketId', bucketId)
      .field('caption', 'A whiteboard photo')
      .attach('image', PNG_1X1, { filename: 'whiteboard.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_NOT_SUPPORTED_IN_SHARED_BUCKET');
  });

  it('still allows an image memory in a bucket the caller merely owns alone (not actually shared)', async () => {
    const token = await registerAndGetToken(app, 'curie-img@example.com');
    const bucket = await request(app).post('/api/buckets').set('Authorization', `Bearer ${token}`).send({ name: 'Solo bucket' });

    const res = await request(app)
      .post('/api/memories/image')
      .set('Authorization', `Bearer ${token}`)
      .field('bucketId', bucket.body.bucket.id)
      .field('caption', 'A whiteboard photo')
      .attach('image', PNG_1X1, { filename: 'whiteboard.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
  });
});
