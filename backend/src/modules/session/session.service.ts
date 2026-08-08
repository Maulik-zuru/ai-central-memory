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

  /** US-ACC-08's "I think my account is compromised" action: everything except the device asking.
   * One updateMany rather than a read-then-loop, so there is no window in which a session created
   * mid-operation survives the sweep. Callers authenticated by API key have no session of their
   * own to preserve, so `exceptSessionId` is optional and every session is revoked in that case. */
  async revokeAllOthers(userId: string, exceptSessionId?: string) {
    const { count } = await prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    if (count > 0) await auditService.record(userId, 'session.revokeAll', { type: 'User', id: userId });
    return count;
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
