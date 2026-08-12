import { readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerMemoryOsTools } from '../src/tools';
import { MemoryOsApiClient } from '../src/client';

// A real McpServer wired to a real Client over an in-memory transport pair — this exercises the
// actual JSON-RPC tool-call path (schema validation, content framing) the way a genuine MCP host
// would, rather than reaching into the server's internal tool registry.
async function connectedClient(apiClient: MemoryOsApiClient) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerMemoryOsTools(server, apiClient);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: { content: { type: string; text?: string }[] }) {
  return result.content[0]?.text ?? '';
}

describe('registerMemoryOsTools', () => {
  it('memoryos_store_memory calls createMemory and returns the created memory', async () => {
    const apiClient = { createMemory: jest.fn().mockResolvedValue({ memory: { id: 'm1', content: 'hi' } }) } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const result = await client.callTool({ name: 'memoryos_store_memory', arguments: { content: 'hi', bucketId: 'b1' } });

    expect(apiClient.createMemory).toHaveBeenCalledWith('hi', 'b1');
    expect(JSON.parse(textOf(result as never))).toEqual({ id: 'm1', content: 'hi' });
  });

  it('memoryos_search_memories maps hasMore to has_more', async () => {
    const apiClient = { searchMemories: jest.fn().mockResolvedValue({ items: [{ id: 'm1' }], hasMore: true }) } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const result = await client.callTool({ name: 'memoryos_search_memories', arguments: { query: 'coffee', limit: 20 } });

    expect(apiClient.searchMemories).toHaveBeenCalledWith({ query: 'coffee', bucketId: undefined, limit: 20 });
    expect(JSON.parse(textOf(result as never))).toEqual({ items: [{ id: 'm1' }], has_more: true });
  });

  it('memoryos_update_or_move_memories routes to a single update when memoryId is set', async () => {
    const apiClient = {
      updateOrMoveMemory: jest.fn().mockResolvedValue({ memory: { id: 'm1', content: 'edited' } }),
      bulkMoveMemories: jest.fn(),
    } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    await client.callTool({ name: 'memoryos_update_or_move_memories', arguments: { memoryId: 'm1', text: 'edited' } });

    expect(apiClient.updateOrMoveMemory).toHaveBeenCalledWith({ memoryId: 'm1', text: 'edited', bucketId: undefined, bucketName: undefined });
    expect(apiClient.bulkMoveMemories).not.toHaveBeenCalled();
  });

  it('memoryos_update_or_move_memories routes to a bulk move when memoryIds is set', async () => {
    const apiClient = {
      updateOrMoveMemory: jest.fn(),
      bulkMoveMemories: jest.fn().mockResolvedValue({ movedCount: 2 }),
    } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const result = await client.callTool({
      name: 'memoryos_update_or_move_memories',
      arguments: { memoryIds: ['m1', 'm2'], bucketId: 'b2' },
    });

    expect(apiClient.bulkMoveMemories).toHaveBeenCalledWith({ memoryIds: ['m1', 'm2'], bucketId: 'b2', bucketName: undefined });
    expect(JSON.parse(textOf(result as never))).toEqual({ movedCount: 2 });
  });

  it('memoryos_update_or_move_memories fails clearly when neither memoryId nor memoryIds is set', async () => {
    const apiClient = {} as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const result = await client.callTool({ name: 'memoryos_update_or_move_memories', arguments: {} });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result as never)).toMatch(/memoryId or memoryIds/);
  });

  it('surfaces an API error as a tool-level error instead of throwing', async () => {
    const apiClient = { listBuckets: jest.fn().mockRejectedValue(new Error('Invalid, expired, or revoked access token')) } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const result = await client.callTool({ name: 'memoryos_list_buckets', arguments: {} });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result as never)).toBe('Invalid, expired, or revoked access token');
  });

  it('memoryos_export_conversation paginates the full transcript and writes it to a local file', async () => {
    const conversation = { id: 'c1', title: 'Trip planning' };
    const apiClient = {
      getConversation: jest
        .fn()
        .mockResolvedValueOnce({ conversation, messages: [{ id: 'msg1' }], nextCursor: 1 })
        .mockResolvedValueOnce({ conversation, messages: [{ id: 'msg2' }], nextCursor: null }),
    } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const dir = await mkdtemp(path.join(tmpdir(), 'mcp-export-'));
    try {
      const result = await client.callTool({
        name: 'memoryos_export_conversation',
        arguments: { conversationId: 'c1', outputDir: dir },
      });

      expect(apiClient.getConversation).toHaveBeenCalledTimes(2);
      expect(apiClient.getConversation).toHaveBeenNthCalledWith(1, 'c1', { cursor: undefined, limit: 500 });
      expect(apiClient.getConversation).toHaveBeenNthCalledWith(2, 'c1', { cursor: 1, limit: 500 });

      const { filePath } = JSON.parse(textOf(result as never));
      const written = JSON.parse(await readFile(filePath, 'utf8'));
      expect(written.conversation).toEqual(conversation);
      expect(written.messages).toEqual([{ id: 'msg1' }, { id: 'msg2' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('memoryos_recall_chat_history returns the synthesized message', async () => {
    const apiClient = {
      recallChatHistory: jest.fn().mockResolvedValue({ conversationId: 'c1', message: { id: 'msg1', content: 'You mentioned X', citations: [] } }),
    } as unknown as MemoryOsApiClient;
    const client = await connectedClient(apiClient);

    const result = await client.callTool({ name: 'memoryos_recall_chat_history', arguments: { query: 'what did I say about X?' } });

    expect(apiClient.recallChatHistory).toHaveBeenCalledWith('what did I say about X?', undefined);
    expect(JSON.parse(textOf(result as never))).toEqual({ id: 'msg1', content: 'You mentioned X', citations: [] });
  });
});
