import { prisma } from '../../shared/prisma';

// The one place ComplianceLog rows are written (US-SEC-05). Deliberately separate from
// auditService: AuditLog cascades from User, so it cannot hold evidence about a deleted account —
// see the ComplianceLog model comment in schema.prisma. Note what this records and what it does
// not: timestamps, an action name, an outcome, and an email to identify whose request it was.
// Never the exported or deleted content itself ("the log itself does not contain the
// exported/deleted content, only metadata about the action").
export interface ComplianceRecord {
  userId: string;
  /** Snapshot at write time — there may be no User row left to join to when this is read back. */
  email?: string;
  action: 'data.export' | 'account.delete';
  requestedAt: Date;
  outcome: 'completed' | 'failed';
}

export const complianceService = {
  async record(entry: ComplianceRecord) {
    const email =
      entry.email ??
      (await prisma.user.findUnique({ where: { id: entry.userId }, select: { email: true } }))?.email ??
      '(unknown — user record already removed)';

    return prisma.complianceLog.create({
      data: {
        userId: entry.userId,
        userEmailSnapshot: email,
        action: entry.action,
        requestedAt: entry.requestedAt,
        completedAt: new Date(),
        outcome: entry.outcome,
      },
    });
  },

  async listForUser(userId: string) {
    return prisma.complianceLog.findMany({ where: { userId }, orderBy: { requestedAt: 'desc' } });
  },
};
