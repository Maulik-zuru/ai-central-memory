import { access } from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import {
  UPLOAD_DIR,
  __setStorageProviderForTests,
  localDiskStorageProvider,
} from '../src/shared/providers/storage.provider';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

function chatGptExport(text: string, title: string) {
  return Buffer.from(
    JSON.stringify([
      {
        title,
        current_node: 'n0',
        mapping: {
          root: { id: 'root', message: null, parent: null, children: ['n0'] },
          n0: {
            id: 'n0',
            message: { author: { role: 'user' }, content: { content_type: 'text', parts: [text] }, create_time: 1700000000 },
            parent: 'root',
            children: [],
          },
        },
      },
    ]),
  );
}

/** Seeds one of everything the export is supposed to include, so "not just a subset" is provable. */
async function seedFullAccount(email: string) {
  const { token, userId, bucketId } = await seedAccount(email);

  await request(app)
    .post('/api/memories')
    .set('Authorization', `Bearer ${token}`)
    .send({ content: 'The launch date moved to next Friday.' });

  await request(app)
    .post('/api/chat-history/import')
    .set('Authorization', `Bearer ${token}`)
    .field('bucketId', bucketId)
    .field('platform', 'chatgpt')
    .attach('file', chatGptExport('We chose Postgres with pgvector.', 'DB decision'), 'export.json');
  await waitFor(() => prisma.conversation.findFirst({ where: { userId } }).then((c) => c ?? undefined));

  const imageMemory = await request(app)
    .post('/api/memories/image')
    .set('Authorization', `Bearer ${token}`)
    .attach('image', Buffer.from('fake-png-bytes'), 'diagram.png')
    .field('caption', 'architecture diagram');
  expect(imageMemory.status).toBe(201);

  return { token, userId, bucketId };
}

describe('Phase 11: data export (US-SEC-03, US-ACC-05)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('includes memories, conversations and file metadata — not just a subset', async () => {
    const { token, userId } = await seedFullAccount('export-a@example.com');

    const requested = await request(app).post('/api/account/export').set('Authorization', `Bearer ${token}`);
    expect(requested.status).toBe(202);

    const completed = await waitFor(() =>
      prisma.dataExportRequest
        .findFirst({ where: { userId } })
        .then((r) => (r?.status === 'complete' ? r : undefined)),
    );

    const download = await request(app)
      .get(`/api/account/export/${completed.id}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(200);

    const archive = JSON.parse(download.text);
    expect(archive.memories.length).toBeGreaterThan(0);
    expect(archive.conversations.length).toBeGreaterThan(0);
    expect(archive.conversations[0].messages.length).toBeGreaterThan(0);
    expect(archive.buckets.length).toBeGreaterThan(0);
    expect(archive.account.email).toBe('export-a@example.com');
  });

  it('records status transitions and a ComplianceLog entry on completion', async () => {
    const { token, userId } = await seedAccount('export-b@example.com');
    await request(app).post('/api/account/export').set('Authorization', `Bearer ${token}`);

    await waitFor(() =>
      prisma.dataExportRequest.findFirst({ where: { userId } }).then((r) => (r?.status === 'complete' ? r : undefined)),
    );

    const log = await prisma.complianceLog.findFirst({ where: { userId, action: 'data.export' } });
    expect(log?.outcome).toBe('completed');
    expect(log?.completedAt).not.toBeNull();
    expect(log?.userEmailSnapshot).toBe('export-b@example.com');
  });

  it('ends a failed export in "failed" with a reason, never stuck at "running"', async () => {
    const { token, userId } = await seedAccount('export-c@example.com');

    // A storage backend that refuses the write is the realistic failure mode for this job (disk
    // full, S3 outage) — injected rather than simulated by deleting the user, so the assertion is
    // about the job's error handling and not about cascade behaviour.
    __setStorageProviderForTests({
      ...localDiskStorageProvider,
      async put() {
        throw new Error('storage unavailable');
      },
    });

    try {
      await request(app).post('/api/account/export').set('Authorization', `Bearer ${token}`);
      const failed = await waitFor(() =>
        prisma.dataExportRequest.findFirst({ where: { userId } }).then((r) => (r?.status === 'failed' ? r : undefined)),
      );
      expect(failed.errorReason).toContain('storage unavailable');
      expect(failed.completedAt).toBeNull();

      // The failure is recorded as compliance evidence too — a request that ran and failed is
      // still a request that was made (US-SEC-05).
      const log = await prisma.complianceLog.findFirst({ where: { userId, action: 'data.export' } });
      expect(log?.outcome).toBe('failed');
    } finally {
      __setStorageProviderForTests(null);
    }
  });

  it('refuses to download an export that has not finished yet', async () => {
    const { token, userId } = await seedAccount('export-f@example.com');
    const queued = await prisma.dataExportRequest.create({ data: { userId, status: 'running' } });

    const res = await request(app)
      .get(`/api/account/export/${queued.id}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXPORT_NOT_READY');
  });

  it('refuses to serve one account&apos;s export archive to another account', async () => {
    const { token: ownerToken, userId } = await seedAccount('export-d@example.com');
    const { token: intruderToken } = await seedAccount('intruder@example.com');

    await request(app).post('/api/account/export').set('Authorization', `Bearer ${ownerToken}`);
    const completed = await waitFor(() =>
      prisma.dataExportRequest.findFirst({ where: { userId } }).then((r) => (r?.status === 'complete' ? r : undefined)),
    );

    const stolen = await request(app)
      .get(`/api/account/export/${completed.id}/download`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(stolen.status).toBe(404);
  });

  it('refuses to serve an expired archive', async () => {
    const { token, userId } = await seedAccount('export-e@example.com');
    await request(app).post('/api/account/export').set('Authorization', `Bearer ${token}`);
    const completed = await waitFor(() =>
      prisma.dataExportRequest.findFirst({ where: { userId } }).then((r) => (r?.status === 'complete' ? r : undefined)),
    );

    await prisma.dataExportRequest.update({
      where: { id: completed.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await request(app)
      .get(`/api/account/export/${completed.id}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe('EXPORT_EXPIRED');
  });
});

describe('Phase 11: permanent account deletion (US-SEC-04, US-ACC-06)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('rejects a deletion without the exact typed confirmation, changing nothing', async () => {
    const { token, userId } = await seedFullAccount('delete-a@example.com');

    for (const body of [{}, { confirmation: 'delete' }, { confirmation: 'yes' }]) {
      const res = await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`).send(body);
      expect(res.status).toBe(400);
    }

    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    expect(await prisma.memory.count({ where: { userId } })).toBeGreaterThan(0);
    expect(await prisma.complianceLog.count({ where: { userId } })).toBe(0);
  });

  it('removes the account, its rows, and its stored objects, leaving compliance evidence behind', async () => {
    const { token, userId } = await seedFullAccount('delete-b@example.com');

    const imageMemory = await prisma.memory.findFirst({ where: { userId, type: 'image' } });
    const storageKey = imageMemory!.imageUrl!.replace('/uploads/', '');
    await access(path.join(UPLOAD_DIR, storageKey)); // present before deletion

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmation: 'DELETE' });
    expect(res.status).toBe(200);

    // Postgres side: the user and everything cascading from them.
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.memory.count({ where: { userId } })).toBe(0);
    expect(await prisma.conversation.count({ where: { userId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);

    // Object-storage side: the half Postgres cascade cannot do for you.
    await expect(access(path.join(UPLOAD_DIR, storageKey))).rejects.toThrow();

    // Evidence that outlives the account it documents — the whole point of ComplianceLog.
    const log = await prisma.complianceLog.findFirst({ where: { userId, action: 'account.delete' } });
    expect(log?.outcome).toBe('completed');
    expect(log?.userEmailSnapshot).toBe('delete-b@example.com');
  });

  it('identifies a deleted account from ComplianceLog alone, with no User row left to join to', async () => {
    const { token, userId } = await seedAccount('delete-c@example.com');
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`).send({ confirmation: 'DELETE' });

    expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(0); // AuditLog cascaded away, as designed

    const log = await prisma.complianceLog.findFirstOrThrow({ where: { userId } });
    expect(log.userEmailSnapshot).toBe('delete-c@example.com');
    expect(log.action).toBe('account.delete');
  });

  it('leaves a deleted account&apos;s credentials unusable immediately', async () => {
    const { token } = await seedAccount('delete-d@example.com');
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`).send({ confirmation: 'DELETE' });

    const afterwards = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
    expect(afterwards.status).toBe(404);
  });
});
