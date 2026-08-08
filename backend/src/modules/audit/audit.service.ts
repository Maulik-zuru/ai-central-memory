import { prisma } from '../../shared/prisma';

// Deep module: every other Phase 1 service calls record() and never touches AuditLog directly.
export const auditService = {
  async record(userId: string, action: string, target?: { type: string; id: string }) {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        targetType: target?.type,
        targetId: target?.id,
      },
    });
  },
};
