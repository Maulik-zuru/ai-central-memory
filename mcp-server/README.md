# AI Memory & Context — Local MCP Server

The local tier of Phase 16's two-tier MCP server (`docs/MemoryPlugin_Parity_Implementation_Plan.md`
Phase 16; the remote/OAuth tier lives at `backend/src/modules/mcp/`). This package runs on the
user's own machine over stdio, authenticating with a static API key instead of OAuth — the tradeoff
the plan's §4 codebase-design note calls out explicitly: two genuinely different trust models
behind one set of 13 tools, not a config flag on one server.

It has no database access. Every tool call is a REST request against this product's own API
(`src/client.ts`), reusing the exact endpoints `docs/MemoryPlugin_Parity_Implementation_Plan.md`
Phase 15 shipped — the same way the remote server reuses services directly, this one reuses the API
surface those services sit behind.

## Development

```sh
npm install
npm run build       # tsc -> dist/
npm run typecheck
npm test
```

## Running it

Create an API key under Settings → API Keys in the dashboard, then either run it directly:

```sh
MEMORYOS_API_KEY=mp_... MEMORYOS_API_BASE_URL=https://your-deployment.example.com node dist/index.js
```

or point an MCP client (Claude Desktop, Claude Code, Cursor) at it via `npx` in its MCP server
config:

```json
{
  "mcpServers": {
    "memoryos": {
      "command": "npx",
      "args": ["ai-memory-mcp-server"],
      "env": {
        "MEMORYOS_API_KEY": "mp_...",
        "MEMORYOS_API_BASE_URL": "https://your-deployment.example.com"
      }
    }
  }
}
```

`MEMORYOS_API_BASE_URL` defaults to `http://localhost:4000` (this repo's own backend default) —
override it for anything other than local development. Startup fails fast with a clear stderr
message (never stdout — that channel is the JSON-RPC protocol stream) if the key is missing or the
server rejects it, rather than connecting and only failing on the first tool call.

## `export_conversation` differs from the remote server's version

The remote (hosted) server has no filesystem of its own to write into, so its
`memoryos_export_conversation` uploads to private storage and returns a 15-minute download link.
This server runs on the user's machine, so it just writes the JSON straight to a local file
(`outputDir`, default the current working directory) and returns that path — a link would be
solving a problem this tier doesn't have.
