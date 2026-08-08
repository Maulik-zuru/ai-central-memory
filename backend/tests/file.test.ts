import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb, waitFor } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { buildTestPdf } from './pdf-fixture';
import { getStorageProvider } from '../src/shared/providers/storage.provider';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  const buckets = await request(app).get('/api/buckets').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string, bucketId: buckets.body.buckets[0].id as string };
}

async function uploadAndWait(token: string, bucketId: string, buffer: Buffer, filename: string, mimeType: string) {
  const res = await request(app)
    .post('/api/files')
    .set('Authorization', `Bearer ${token}`)
    .field('bucketId', bucketId)
    .attach('file', buffer, { filename, contentType: mimeType });
  return res;
}

describe('Files — upload & processing (US-FIL-01)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('rejects an unsupported file type before any File row is created', async () => {
    const { token, bucketId } = await seedAccount('file-a@example.com');
    const res = await uploadAndWait(token, bucketId, Buffer.from('not a real binary'), 'virus.exe', 'application/x-msdownload');

    expect(res.status).toBe(400);
    const count = await prisma.file.count();
    expect(count).toBe(0);
  });

  it('processes a PDF into page-aware chunks and marks it ready', async () => {
    const { token, bucketId } = await seedAccount('file-b@example.com');
    const pdf = buildTestPdf(['Termination after ninety days notice.', 'Unrelated appendix content here.']);

    const res = await uploadAndWait(token, bucketId, pdf, 'contract.pdf', 'application/pdf');
    expect(res.status).toBe(201);

    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: res.body.file.id } }).then((f) => (f?.status !== 'processing' ? f : undefined)),
    );
    expect(file?.status).toBe('ready');
    expect(file?.pageCount).toBe(2);

    const chunks = await prisma.fileChunk.findMany({ where: { fileId: file!.id } });
    expect(chunks.length).toBe(2);
  });

  it('ends in a clear error state for a file with no extractable text', async () => {
    const { token, bucketId } = await seedAccount('file-c@example.com');
    const emptyPdf = buildTestPdf(['']);

    const res = await uploadAndWait(token, bucketId, emptyPdf, 'scanned.pdf', 'application/pdf');
    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: res.body.file.id } }).then((f) => (f?.status !== 'processing' ? f : undefined)),
    );

    expect(file?.status).toBe('error');
    expect(file?.errorReason).toMatch(/no readable text/i);
  });
});

describe('Files — chunk/page integrity', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('never produces a chunk that spans two pages', async () => {
    const { token, bucketId } = await seedAccount('file-d@example.com');
    const pageTexts = ['Termination after ninety days notice.', 'Unrelated appendix content here.'];
    const pdf = buildTestPdf(pageTexts);

    const res = await uploadAndWait(token, bucketId, pdf, 'contract.pdf', 'application/pdf');
    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: res.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
    );

    const chunks = await prisma.fileChunk.findMany({ where: { fileId: file!.id } });
    for (const chunk of chunks) {
      const expectedPageText = pageTexts[chunk.page - 1];
      // Every word of the chunk belongs to exactly the one page it's tagged with — proof it
      // wasn't assembled from two pages' text.
      expect(expectedPageText).toContain(chunk.content.trim());
    }
  });
});

describe('Files — Q&A with citations (US-FIL-03)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('answers with a citation pointing at the page that actually contains the match', async () => {
    const { token, bucketId } = await seedAccount('file-e@example.com');
    const pdf = buildTestPdf(['Termination after ninety days notice.', 'Unrelated appendix content here.']);

    const upload = await uploadAndWait(token, bucketId, pdf, 'contract.pdf', 'application/pdf');
    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: upload.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
    );

    const res = await request(app)
      .post(`/api/files/${file!.id}/ask`)
      .set('Authorization', `Bearer ${token}`)
      .send({ question: "What is the file's termination notice period?" });

    expect(res.status).toBe(200);
    expect(res.body.citations.length).toBeGreaterThan(0);
    expect(res.body.citations[0].page).toBe(1);
    expect(res.body.citations[0].excerpt).toMatch(/termination/i);
  });

  it("says nothing answers the question when the file doesn't cover it", async () => {
    const { token, bucketId } = await seedAccount('file-f@example.com');
    const pdf = buildTestPdf(['Unrelated appendix content here.']);

    const upload = await uploadAndWait(token, bucketId, pdf, 'appendix.pdf', 'application/pdf');
    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: upload.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
    );

    const res = await request(app)
      .post(`/api/files/${file!.id}/ask`)
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What is the exact wire transfer routing number mentioned?' });

    expect(res.status).toBe(200);
    expect(res.body.citations.length).toBe(0);
    expect(res.body.answer.toLowerCase()).toMatch(/doesn't seem to have|nothing/i);
  });

  it('403s asking a question against a file in a bucket the caller is not a member of', async () => {
    const { token: ownerToken, bucketId } = await seedAccount('file-owner@example.com');
    const { token: outsiderToken } = await seedAccount('file-outsider@example.com');

    const pdf = buildTestPdf(['Termination after ninety days notice.']);
    const upload = await uploadAndWait(ownerToken, bucketId, pdf, 'contract.pdf', 'application/pdf');
    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: upload.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
    );

    const res = await request(app)
      .post(`/api/files/${file!.id}/ask`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ question: 'anything' });

    expect(res.status).toBe(403);
  });
});

describe('Files — search (US-FIL-04)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('matches on extracted content the filename does not contain', async () => {
    const { token, bucketId } = await seedAccount('file-g@example.com');
    const pdf = buildTestPdf(['Termination after ninety days notice.']);

    const upload = await uploadAndWait(token, bucketId, pdf, 'random-file-name-123.pdf', 'application/pdf');
    await waitFor(() =>
      prisma.file.findUnique({ where: { id: upload.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
    );

    const res = await request(app)
      .post('/api/files/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'notice period before ending the agreement' });

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].fileId).toBe(upload.body.file.id);
  });
});

describe('Files — deletion cleanup', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('removes chunks and the underlying storage object when a file is deleted', async () => {
    const { token, bucketId } = await seedAccount('file-h@example.com');
    const pdf = buildTestPdf(['Termination after ninety days notice.']);

    const upload = await uploadAndWait(token, bucketId, pdf, 'contract.pdf', 'application/pdf');
    const file = await waitFor(() =>
      prisma.file.findUnique({ where: { id: upload.body.file.id } }).then((f) => (f?.status === 'ready' ? f : undefined)),
    );

    const del = await request(app).delete(`/api/files/${file!.id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const remainingChunks = await prisma.fileChunk.count({ where: { fileId: file!.id } });
    expect(remainingChunks).toBe(0);

    await expect(getStorageProvider().get(file!.storageKey)).rejects.toBeTruthy();
  });
});
