import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';

const app = createApp();

describe('Automatic capture (US-MEM-03)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('produces a pending suggestion, never a live memory, from a conversation snippet', async () => {
    const token = await registerAndGetToken(app, 'ada@example.com');
    const res = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'By the way, I deploy my side projects to Railway now, not Vercel.' });

    expect(res.status).toBe(201);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.suggestions[0].type).toBe('capture');
    expect(res.body.suggestions[0].status).toBe('pending');

    const memories = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(memories.body.items).toHaveLength(0);
  });

  it('approving a capture suggestion saves it as a real memory', async () => {
    const token = await registerAndGetToken(app, 'grace@example.com');
    const capture = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'We ship every Friday afternoon.' });

    const suggestionId = capture.body.suggestions[0].id;
    const approve = await request(app).post(`/api/suggestions/${suggestionId}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const memories = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(memories.body.items).toHaveLength(1);
    expect(memories.body.items[0].source).toBe('auto');
  });

  it('dismissing a capture suggestion does not re-suggest the identical snippet', async () => {
    const token = await registerAndGetToken(app, 'turing@example.com');
    const snippet = 'We ship every Friday afternoon.';

    const first = await request(app).post('/api/capture').set('Authorization', `Bearer ${token}`).send({ snippet });
    await request(app)
      .post(`/api/suggestions/${first.body.suggestions[0].id}/dismiss`)
      .set('Authorization', `Bearer ${token}`);

    const second = await request(app).post('/api/capture').set('Authorization', `Bearer ${token}`).send({ snippet });
    expect(second.body.suggestions).toHaveLength(0);

    const pending = await request(app).get('/api/suggestions').set('Authorization', `Bearer ${token}`);
    expect(pending.body.suggestions).toHaveLength(0);
  });
});
