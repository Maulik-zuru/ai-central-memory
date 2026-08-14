import { ApiClientError, MemoryOsApiClient } from '../src/client';

function fakeFetch(response: { status: number; body?: unknown }) {
  return jest.fn().mockResolvedValue({
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    json: async () => response.body,
  });
}

describe('MemoryOsApiClient', () => {
  const client = new MemoryOsApiClient({ baseUrl: 'http://localhost:4000/', apiKey: 'mp_test' });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the API key as a bearer token and strips a trailing slash from the base URL', async () => {
    const fetchMock = fakeFetch({ status: 200, body: { buckets: [] } });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.listBuckets();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/buckets',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer mp_test' }) }),
    );
  });

  it('encodes query parameters and omits undefined ones', async () => {
    const fetchMock = fakeFetch({ status: 200, body: { items: [], hasMore: false } });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.searchMemories({ query: 'coffee shops', bucketId: undefined, limit: 10 });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/memories/search?query=coffee%20shops&limit=10');
  });

  it('throws ApiClientError with the server-provided message on a non-2xx response', async () => {
    global.fetch = fakeFetch({ status: 403, body: { error: { code: 'BUCKET_ACCESS_DENIED', message: 'You do not have access to this bucket' } } }) as unknown as typeof fetch;

    await expect(client.listBucketCategories('some-bucket')).rejects.toThrow(ApiClientError);
    await expect(client.listBucketCategories('some-bucket')).rejects.toThrow('You do not have access to this bucket');
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as typeof fetch;

    await expect(client.listBuckets()).rejects.toThrow('Request failed with status 500');
  });

  it('treats a 204 response as no body', async () => {
    global.fetch = fakeFetch({ status: 204 }) as unknown as typeof fetch;
    await expect(client.verifyCredentials()).resolves.toBeUndefined();
  });

  it('recallChatHistory posts to /api/chat-history/inject with the default 600-token budget', async () => {
    const fetchMock = fakeFetch({ status: 200, body: { summary: 'x', citations: [] } });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.recallChatHistory('what did I say about X?', 'bucket-1');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/chat-history/inject');
    expect(JSON.parse(options.body)).toEqual({ query: 'what did I say about X?', bucketId: 'bucket-1', maxTokens: 600 });
  });
});
