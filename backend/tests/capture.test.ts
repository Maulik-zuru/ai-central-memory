import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { getLlmProvider, __setLlmProviderForTests } from '../src/shared/providers/llm.provider';

const app = createApp();

async function submitCapture(token: string, snippet: string) {
  const res = await request(app).post('/api/capture').set('Authorization', `Bearer ${token}`).send({ snippet });
  expect(res.status).toBe(202);
  expect(res.body).toEqual({ status: 'queued' });
  return res;
}

describe('Automatic capture (US-MEM-03)', () => {
  beforeEach(resetDb);
  afterAll(() => {
    __setLlmProviderForTests(null);
    return disconnect();
  });

  it('produces a pending suggestion, never a live memory, from a conversation snippet — response returns before extraction finishes', async () => {
    const token = await registerAndGetToken(app, 'ada@example.com');
    const snippet = 'By the way, I deploy my side projects to Railway now, not Vercel.';
    await submitCapture(token, snippet);

    const suggestions = await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => (res.body.suggestions.length > 0 ? res.body.suggestions : undefined)),
    );
    expect(suggestions[0].type).toBe('capture');
    expect(suggestions[0].status).toBe('pending');

    const memories = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(memories.body.items).toHaveLength(0);
  });

  it('approving a capture suggestion saves it as a real memory', async () => {
    const token = await registerAndGetToken(app, 'grace@example.com');
    await submitCapture(token, 'We ship every Friday afternoon.');

    const suggestions = await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => (res.body.suggestions.length > 0 ? res.body.suggestions : undefined)),
    );
    const approve = await request(app).post(`/api/suggestions/${suggestions[0].id}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);

    const memories = await request(app).get('/api/memories').set('Authorization', `Bearer ${token}`);
    expect(memories.body.items).toHaveLength(1);
    expect(memories.body.items[0].source).toBe('auto');
  });

  it('dismissing a capture suggestion does not re-suggest the identical snippet', async () => {
    const token = await registerAndGetToken(app, 'turing@example.com');
    const snippet = 'We ship every Friday afternoon.';

    await submitCapture(token, snippet);
    const first = await waitFor(() =>
      request(app)
        .get('/api/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => (res.body.suggestions.length > 0 ? res.body.suggestions : undefined)),
    );
    await request(app).post(`/api/suggestions/${first[0].id}/dismiss`).set('Authorization', `Bearer ${token}`);

    await submitCapture(token, snippet);
    // No new suggestion ever shows up for the identical, already-dismissed draft — give the
    // fire-and-forget pipeline a moment to (not) create one rather than asserting instantly.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const pending = await request(app).get('/api/suggestions').set('Authorization', `Bearer ${token}`);
    expect(pending.body.suggestions).toHaveLength(0);
  });

  it('the capture endpoint responds before the extraction LLM call resolves (Phase 18 §7.4)', async () => {
    const token = await registerAndGetToken(app, 'lovelace@example.com');
    const real = getLlmProvider();
    let extractionResolved = false;
    __setLlmProviderForTests({
      ...real,
      extractMemoryCandidates: async (snippet) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        extractionResolved = true;
        return real.extractMemoryCandidates(snippet);
      },
    });

    const res = await request(app)
      .post('/api/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({ snippet: 'We migrated the whole stack to Postgres last quarter.' });

    // The HTTP response is back well before the artificially slow extraction call resolves —
    // proof the write path no longer blocks on it, not just that a suggestion eventually appears.
    expect(res.status).toBe(202);
    expect(extractionResolved).toBe(false);

    await waitFor(async () => (extractionResolved ? true : undefined));
    const suggestions = await request(app).get('/api/suggestions').set('Authorization', `Bearer ${token}`);
    expect(suggestions.body.suggestions.length).toBeGreaterThan(0);
  });
});
