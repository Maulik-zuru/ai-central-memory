import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';

const app = createApp();

// A minimal valid 1x1 PNG, used only to exercise the upload pipeline end-to-end.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Image memories (US-MEM-05)', () => {
  beforeEach(resetDb);
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
});
