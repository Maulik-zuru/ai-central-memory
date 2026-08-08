import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';

function toPublicSession(session: {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: Date;
  createdAt: Date;
}) {
  return {
    id: session.id,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    lastActiveAt: session.lastActiveAt,
    createdAt: session.createdAt,
  };
}

export const sessionService = {
  async list(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
    return sessions.map(toPublicSession);
  },

  async revoke(userId: string, sessionId: string) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw AppError.notFound('Session not found');
    }
    if (!session.revokedAt) {
      await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      await auditService.record(userId, 'session.revoke', { type: 'Session', id: sessionId });
    }
  },
};
