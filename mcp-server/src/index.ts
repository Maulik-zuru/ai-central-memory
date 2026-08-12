#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemoryOsApiClient, ApiClientError } from './client';
import { registerMemoryOsTools } from './tools';

// stdio IS the JSON-RPC channel (the MCP client reads stdout as protocol frames) — every log line
// here must go to stderr, never console.log, or a client stops parsing correctly.
function log(message: string) {
  process.stderr.write(`[ai-memory-mcp-server] ${message}\n`);
}

async function main() {
  const apiKey = process.env.MEMORYOS_API_KEY;
  const baseUrl = process.env.MEMORYOS_API_BASE_URL ?? 'http://localhost:4000';

  if (!apiKey) {
    log('MEMORYOS_API_KEY is not set. Create one under Settings → API Keys and pass it via the MEMORYOS_API_KEY environment variable.');
    process.exit(1);
  }

  const client = new MemoryOsApiClient({ baseUrl, apiKey });

  try {
    await client.verifyCredentials();
  } catch (err) {
    const reason = err instanceof ApiClientError ? err.message : (err as Error).message;
    log(`Could not authenticate against ${baseUrl}: ${reason}`);
    process.exit(1);
  }

  const server = new McpServer({ name: 'memoryos-mcp-server', version: '1.0.0' });
  registerMemoryOsTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`Connected to ${baseUrl}. Waiting for requests on stdio.`);

  // Both signals mean the host process is tearing this one down — close cleanly rather than
  // leaving the client's next call hanging on a half-shut-down transport.
  const shutdown = () => {
    void server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log(`Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
