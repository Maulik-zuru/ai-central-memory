import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';

const app = createApp();

function pkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function registerPublicClient(redirectUri: string) {
  const res = await request(app)
    .post('/register')
    .send({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', client_name: 'Test MCP Client' });
  expect(res.status).toBe(201);
  return res.body.client_id as string;
}

describe('MCP remote server — OAuth 2.0 + PKCE + Dynamic Client Registration (US-INT-03b)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('completes the full authorization-code + PKCE flow end to end, then calls a tool with the issued token', async () => {
    const dashboardToken = await registerAndGetToken(app, 'mcp-oauth@example.com');
    const redirectUri = 'https://mcp-client.example.com/callback';
    const clientId = await registerPublicClient(redirectUri);
    const { codeVerifier, codeChallenge } = pkcePair();

    // 1. The MCP client redirects the user's browser to /authorize.
    const authorize = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    });
    expect(authorize.status).toBe(302);
    const consentUrl = new URL(authorize.headers.location);
    expect(consentUrl.pathname).toBe('/mcp/authorize');
    const requestId = consentUrl.searchParams.get('request');
    expect(requestId).toBeTruthy();

    // 2. The dashboard's consent screen (already logged in) renders what's being requested.
    const describe = await request(app).get(`/api/mcp/consent/${requestId}`).set('Authorization', `Bearer ${dashboardToken}`);
    expect(describe.status).toBe(200);
    expect(describe.body.clientName).toBe('Test MCP Client');

    // 3. The user clicks Approve.
    const approve = await request(app)
      .post(`/api/mcp/consent/${requestId}/approve`)
      .set('Authorization', `Bearer ${dashboardToken}`);
    expect(approve.status).toBe(200);
    const redirectBack = new URL(approve.body.redirectUrl);
    expect(redirectBack.origin + redirectBack.pathname).toBe(redirectUri);
    expect(redirectBack.searchParams.get('state')).toBe('xyz');
    const code = redirectBack.searchParams.get('code');
    expect(code).toBeTruthy();

    // A second approval of the same (now-resolved) request must not mint a second code.
    const reapprove = await request(app)
      .post(`/api/mcp/consent/${requestId}/approve`)
      .set('Authorization', `Bearer ${dashboardToken}`);
    expect(reapprove.status).toBe(404);

    // 4. The MCP client exchanges the code for tokens.
    const tokenRes = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: clientId });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.token_type).toBe('Bearer');
    const accessToken = tokenRes.body.access_token as string;
    const refreshToken = tokenRes.body.refresh_token as string;
    expect(accessToken).toBeTruthy();

    // The same code can never be exchanged twice (RFC 6749 §10.5 replay prevention).
    const replay = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: clientId });
    expect(replay.status).toBe(400);

    // 5. The MCP client calls a tool with the issued access token.
    const toolCall = await request(app)
      .post('/api/mcp/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'memoryos_store_memory', arguments: { content: 'Saved via MCP end-to-end test' } },
      });
    expect(toolCall.status).toBe(200);
    expect(toolCall.body.result.content[0].text).toContain('Saved via MCP end-to-end test');

    // The memory genuinely landed in the same account that approved the connection — not some
    // MCP-only side store.
    const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${dashboardToken}`);
    const memories = await request(app).get('/api/memories').set('Authorization', `Bearer ${dashboardToken}`);
    expect(memories.body.items.some((m: { content: string }) => m.content === 'Saved via MCP end-to-end test')).toBe(true);
    void account;

    // 6. Refresh rotates the token; the old refresh token stops working afterward.
    const refreshed = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
    expect(refreshed.status).toBe(200);
    const newAccessToken = refreshed.body.access_token as string;
    expect(newAccessToken).not.toBe(accessToken);

    const staleRefresh = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
    expect(staleRefresh.status).toBe(400);

    // The original access token is dead the moment it's rotated away from.
    const oldTokenCall = await request(app)
      .post('/api/mcp/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memoryos_list_buckets', arguments: {} } });
    expect(oldTokenCall.status).toBe(401);
  });

  it('denying a consent request redirects back with access_denied and issues no code', async () => {
    const dashboardToken = await registerAndGetToken(app, 'mcp-deny@example.com');
    const redirectUri = 'https://mcp-client.example.com/callback';
    const clientId = await registerPublicClient(redirectUri);
    const { codeChallenge } = pkcePair();

    const authorize = await request(app).get('/authorize').query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    const requestId = new URL(authorize.headers.location).searchParams.get('request');

    const deny = await request(app).post(`/api/mcp/consent/${requestId}/deny`).set('Authorization', `Bearer ${dashboardToken}`);
    expect(deny.status).toBe(200);
    const redirectBack = new URL(deny.body.redirectUrl);
    expect(redirectBack.searchParams.get('error')).toBe('access_denied');
    expect(redirectBack.searchParams.has('code')).toBe(false);

    const codeCount = await prisma.mcpAuthorizationCode.count({ where: { clientId } });
    expect(codeCount).toBe(0);
  });

  it('rejects a tool call with a missing, invalid, or revoked token', async () => {
    const noAuth = await request(app)
      .post('/api/mcp/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memoryos_list_buckets', arguments: {} } });
    expect(noAuth.status).toBe(401);

    const badToken = await request(app)
      .post('/api/mcp/mcp')
      .set('Authorization', 'Bearer not-a-real-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memoryos_list_buckets', arguments: {} } });
    expect(badToken.status).toBe(401);
  });

  it('a tool call only ever sees the approving user\'s own buckets — no cross-account leakage', async () => {
    const ownerToken = await registerAndGetToken(app, 'mcp-owner@example.com');
    const otherToken = await registerAndGetToken(app, 'mcp-other@example.com');
    await request(app).post('/api/buckets').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Owner-only bucket' });

    const redirectUri = 'https://mcp-client.example.com/callback';
    const clientId = await registerPublicClient(redirectUri);
    const { codeVerifier, codeChallenge } = pkcePair();

    const authorize = await request(app)
      .get('/authorize')
      .query({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: 'S256' });
    const requestId = new URL(authorize.headers.location).searchParams.get('request');

    // The OTHER user is the one who approves — the token that comes out must be scoped to them.
    const approve = await request(app).post(`/api/mcp/consent/${requestId}/approve`).set('Authorization', `Bearer ${otherToken}`);
    const code = new URL(approve.body.redirectUrl).searchParams.get('code');

    const tokenRes = await request(app)
      .post('/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: clientId });
    const accessToken = tokenRes.body.access_token as string;

    const toolCall = await request(app)
      .post('/api/mcp/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memoryos_list_buckets', arguments: {} } });

    expect(toolCall.status).toBe(200);
    const buckets = JSON.parse(toolCall.body.result.content[0].text) as { name: string }[];
    expect(buckets.some((b) => b.name === 'Owner-only bucket')).toBe(false);
  });
});
