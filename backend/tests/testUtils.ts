import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../src/shared/prisma';

export async function registerAndGetToken(app: Express, email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'Str0ngPassw0rd' });
  return res.body.accessToken as string;
}

export async function resetDb() {
  // Order matters: children before parents.
  // ProcessedWebhookEvent has no userId (a Stripe event isn't scoped to one account) so it never
  // cascades from a user delete below — cleared explicitly, the same reason it's here and not in
  // the per-model deletes further down.
  await prisma.processedWebhookEvent.deleteMany();
  // ComplianceLog deliberately has no User relation (see schema.prisma) — surviving a user delete
  // is the point of it, which also means it survives resetDb's user delete and must be cleared here.
  await prisma.complianceLog.deleteMany();
  // An unclaimed pairing code has no userId, so it never cascades from the user delete below.
  await prisma.devicePairingCode.deleteMany();
  await prisma.desktopAgentDevice.deleteMany();
  await prisma.memorySuggestion.deleteMany();
  await prisma.memoryVersion.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.bucket.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.session.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
}

export async function disconnect() {
  await prisma.$disconnect();
}

/** Polls until `check()` returns truthy or the timeout elapses — for asserting on the
 * fire-and-forget embedding pipeline (see embedding.service.ts) without a real job queue to await. */
export async function waitFor<T>(check: () => Promise<T | undefined | null | false>, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
