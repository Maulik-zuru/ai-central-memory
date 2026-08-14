import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { rechunkService } from '../src/modules/chat-history/rechunk.service';
import { tokenCount } from '../src/shared/tokenizer';

const app = createApp();
afterAll(disconnect);

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

// Simulates a message imported before Phase 17 existed: a Conversation/Message created directly
// (bypassing sync.service.ts, which now always chunks with the new algorithm and sets
// rechunkedAt), with one old-style oversized single chunk and no rechunkedAt marker.
async function seedLegacyMessage(userId: string, bucketId: string, content: string) {
  const conversation = await prisma.conversation.create({
    data: { bucketId, userId, platform: 'chatgpt', contentHash: `legacy-${Date.now()}-${Math.random()}`, title: 'Legacy', status: 'ready', messageCount: 1 },
  });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, role: 'user', content, position: 0, createdAt: new Date() },
  });
  await prisma.messageChunk.create({ data: { messageId: message.id, content } });
  return { conversation, message };
}

describe('rechunk.service — Phase 17 re-chunk migration (US-ARC-07)', () => {
  beforeEach(resetDb);

  it('dryRun reports messages awaiting migration without changing anything', async () => {
    const { userId, bucketId } = await seedAccount('rechunk-dryrun@example.com');
    await seedLegacyMessage(userId, bucketId, 'A short legacy message.');

    const before = await rechunkService.dryRun();
    expect(before.messagesRemaining).toBe(1);

    const chunksBefore = await prisma.messageChunk.count();
    expect(chunksBefore).toBe(1);

    const after = await rechunkService.dryRun();
    expect(after.messagesRemaining).toBe(1); // unchanged — dry run never writes
    expect(await prisma.messageChunk.count()).toBe(chunksBefore);
  });

  it('run() replaces old chunks with the new token-based shape and marks the message migrated', async () => {
    const { userId, bucketId } = await seedAccount('rechunk-run@example.com');
    const bigContent = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    const { message } = await seedLegacyMessage(userId, bucketId, bigContent);

    const result = await rechunkService.run();
    expect(result.messagesProcessed).toBe(1);

    const migrated = await prisma.message.findUnique({ where: { id: message.id } });
    expect(migrated?.rechunkedAt).not.toBeNull();

    const newChunks = await prisma.messageChunk.findMany({ where: { messageId: message.id }, orderBy: { id: 'asc' } });
    expect(newChunks.length).toBeGreaterThan(1); // the old single oversized chunk is gone
    for (const chunk of newChunks) {
      expect(tokenCount(chunk.content)).toBeLessThanOrEqual(256);
    }

    const withEmbedding = await prisma.$queryRaw<{ hasEmbedding: boolean }[]>`
      SELECT (embedding IS NOT NULL) AS "hasEmbedding" FROM "MessageChunk" WHERE "messageId" = ${message.id}
    `;
    expect(withEmbedding.every((r) => r.hasEmbedding)).toBe(true);
  });

  it('is idempotent — re-running after completion processes nothing further', async () => {
    const { userId, bucketId } = await seedAccount('rechunk-idempotent@example.com');
    await seedLegacyMessage(userId, bucketId, 'Another legacy message worth migrating.');

    await rechunkService.run();
    expect((await rechunkService.dryRun()).messagesRemaining).toBe(0);

    const second = await rechunkService.run();
    expect(second.messagesProcessed).toBe(0);
  });

  it('a message imported through the normal flow is already excluded from the backlog', async () => {
    const { token, bucketId } = await seedAccount('rechunk-fresh@example.com');
    const mapping = {
      root: { id: 'root', message: null, parent: null, children: [] },
      n1: { id: 'n1', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['A fresh message.'] }, create_time: 1700000000 }, parent: 'root', children: [] },
    };
    const buffer = Buffer.from(JSON.stringify([{ title: 'Fresh', current_node: 'n1', mapping }]));
    await request(app).post('/api/chat-history/import').set('Authorization', `Bearer ${token}`).field('bucketId', bucketId).field('platform', 'chatgpt').attach('file', buffer, 'export.json');
    await waitFor(() => prisma.conversation.findFirst({ where: { bucketId, title: 'Fresh', status: 'ready' } }));

    expect((await rechunkService.dryRun()).messagesRemaining).toBe(0);
  });
});
