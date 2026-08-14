// Phase 16 (US-INT-03a): a thin HTTP client over this product's REST API, standing in for the
// direct Prisma/service calls the remote (in-process) MCP tools use — see
// backend/src/modules/mcp/mcp.tools.ts. This process runs on the user's own machine with no
// database access, so every tool call becomes exactly one authenticated REST request instead.

export class ApiClientError extends Error {}

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number][];
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export class MemoryOsApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

    const payload = (await res.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
    if (!res.ok) {
      const message = payload?.error?.message ?? `Request failed with status ${res.status}`;
      throw new ApiClientError(message);
    }
    return payload as T;
  }

  /** A cheap authenticated call used only to confirm the API key works at startup. */
  async verifyCredentials(): Promise<void> {
    await this.request('GET', '/api/account/me');
  }

  createMemory(content: string, bucketId?: string) {
    return this.request<{ memory: unknown }>('POST', '/api/memories', { content, bucketId });
  }

  getMemoriesAndBuckets(opts: { bucketId?: string; cursor?: string; limit: number }) {
    return this.request<{ memories: unknown[]; nextCursor: string | null; buckets: unknown[] }>(
      'GET',
      `/api/v2/memory${qs(opts)}`,
    );
  }

  searchMemories(opts: { query: string; bucketId?: string; limit: number }) {
    return this.request<{ items: unknown[]; hasMore: boolean }>('GET', `/api/memories/search${qs(opts)}`);
  }

  listBuckets() {
    return this.request<{ buckets: unknown[] }>('GET', '/api/buckets');
  }

  createBucket(name: string, parentId?: string) {
    return this.request<{ bucket: unknown }>('POST', '/api/buckets', { name, parentId });
  }

  updateOrMoveMemory(body: { memoryId: string; text?: string; bucketId?: string; bucketName?: string }) {
    return this.request<{ memory: unknown }>('POST', '/api/v2/memory/update', body);
  }

  bulkMoveMemories(body: { memoryIds: string[]; bucketId?: string; bucketName?: string }) {
    return this.request<{ movedCount: number }>('POST', '/api/v2/memory/update', body);
  }

  listBucketCategories(bucketId?: string) {
    return this.request<{ categories: unknown[] }>('GET', `/api/categories${qs({ bucketId })}`);
  }

  listCategoryMemories(categoryId: string, opts: { cursor?: string; limit: number }) {
    return this.request<{ items: unknown[]; nextCursor: string | null }>(
      'GET',
      `/api/categories/${encodeURIComponent(categoryId)}/memories${qs(opts)}`,
    );
  }

  // Phase 17 (US-ARC-07): the six-stage recall pipeline via /inject — the same endpoint the REST
  // API and the remote MCP server's recall_chat_history tool both call. Default 600-token budget
  // matches MemoryPlugin_Clone_Spec.md §6's /inject default.
  recallChatHistory(query: string, bucketId?: string) {
    return this.request<{ summary: string; citations: unknown[] }>('POST', '/api/chat-history/inject', {
      query,
      bucketId,
      maxTokens: 600,
    });
  }

  getConversation(conversationId: string, opts: { cursor?: number; limit: number }) {
    return this.request<{ conversation: unknown; messages: unknown[]; nextCursor: number | null }>(
      'GET',
      `/api/chat-history/conversations/${encodeURIComponent(conversationId)}${qs(opts)}`,
    );
  }

  searchUploadedFiles(query: string, bucketId?: string) {
    return this.request<{ results: unknown[] }>('POST', '/api/files/search', { query, bucketId });
  }
}
