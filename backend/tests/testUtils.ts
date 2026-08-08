import { prisma } from '../src/shared/prisma';

export async function resetDb() {
  // Order matters: children before parents. Phase 1 has no cascading concerns beyond User yet,
  // but this stays explicit so future models don't silently break test isolation.
  await prisma.auditLog.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.session.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
}

export async function disconnect() {
  await prisma.$disconnect();
}
