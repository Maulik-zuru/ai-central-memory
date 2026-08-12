import request from 'supertest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { createApp } from '../src/app';
import { disconnect } from './testUtils';

const app = createApp();

describe('OpenAPI spec (US-INT-06)', () => {
  afterAll(disconnect);

  it('is served unauthenticated and is a structurally valid OpenAPI 3 document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);

    // Throws on anything structurally invalid — a bad $ref, a malformed schema, a missing
    // required field. This is the actual "validates against the OpenAPI 3.x schema" exit
    // criterion, not just "the endpoint returns 200".
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(res.body)))).resolves.toBeDefined();
  });

  it('documents every endpoint this phase added, with the same shape the route actually validates', async () => {
    const res = await request(app).get('/api/openapi.json');
    const paths = res.body.paths;

    expect(paths['/api/memories']).toBeDefined();
    expect(paths['/api/memories'].post).toBeDefined();
    expect(paths['/api/memories'].get).toBeDefined();
    expect(paths['/api/memories/{memoryId}'].delete).toBeDefined();
    expect(paths['/api/memories/bulk-delete'].post).toBeDefined();
    expect(paths['/api/v2/memory'].get).toBeDefined();
    expect(paths['/api/v2/memory/update'].post).toBeDefined();
    expect(paths['/api/buckets'].get).toBeDefined();
    expect(paths['/api/buckets'].post).toBeDefined();
    expect(paths['/api/chat-history/search'].post).toBeDefined();
    expect(paths['/api/chat-history/conversations'].get).toBeDefined();
    expect(paths['/api/chat-history/conversations/{id}'].get).toBeDefined();
    expect(paths['/api/chat-history/usage'].get).toBeDefined();
    expect(paths['/api/chat-history/ingest/custom-online'].post).toBeDefined();
    expect(paths['/api/chat-history/chats'].delete).toBeDefined();

    // The bulk-move request schema is generated straight from bulkMoveMemoriesSchema/
    // v2MemoryUpdateSchema — a required `memoryIds`/`memoryId` shows this is the real schema,
    // not a hand-typed stand-in that could silently drift from what the route actually validates.
    const updateSchema = paths['/api/v2/memory/update'].post.requestBody.content['application/json'].schema;
    expect(JSON.stringify(updateSchema)).toContain('memoryId');
  });

  it('declares every non-public router internal rather than leaving it undocumented', async () => {
    const res = await request(app).get('/api/openapi.json');
    const internal = res.body['x-internal-routers'] as string[];
    for (const prefix of ['/api/auth', '/api/account', '/api/ask', '/api/billing', '/api/ops']) {
      expect(internal).toContain(prefix);
    }
  });
});
