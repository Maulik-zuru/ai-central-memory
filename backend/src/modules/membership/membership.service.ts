import crypto from 'crypto';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { sha256Hex } from '../../shared/tokens';
import { getEmailProvider } from '../../shared/providers/email.provider';
import { hasPlan } from '../../shared/requirePlan';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Retrofit (docs/Phase10_Implementation_Plan.md §3): shared buckets are Must/Pro, but a cap — not
// zero — for Core, matching "works for any plan today" being narrowed rather than removed
// outright. Counts existing members, not pending invites, so re-inviting an already-counted
// collaborator never double-charges the cap.
const FREE_COLLABORATOR_CAP = 3;

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function countOwners(bucketId: string): Promise<number> {
  return prisma.bucketMember.count({ where: { bucketId, role: 'owner' } });
}

export const membershipService = {
  async invite(bucketId: string, invitedByUserId: string, email: string, role: 'editor' | 'viewer') {
    const bucket = await prisma.bucket.findUniqueOrThrow({ where: { id: bucketId } });

    if (!(await hasPlan(invitedByUserId, 'pro'))) {
      const memberCount = await prisma.bucketMember.count({ where: { bucketId } });
      if (memberCount >= FREE_COLLABORATOR_CAP) {
        throw AppError.forbidden(
          `Free buckets are capped at ${FREE_COLLABORATOR_CAP} collaborators. Upgrade to Pro for unlimited collaborators.`,
          'PRO_FEATURE',
        );
      }
    }

    const rawToken = generateInviteToken();

    const invite = await prisma.bucketInvite.create({
      data: {
        bucketId,
        email,
        role,
        tokenHash: sha256Hex(rawToken),
        invitedBy: invitedByUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    // The invited person has no access at all until they accept (US-ORG-04 AC) — creating this
    // row grants nothing by itself; only acceptInvite() creates a BucketMember.
    await getEmailProvider().send({
      to: email,
      subject: `You've been invited to "${bucket.name}"`,
      html: `<p>You've been invited to collaborate on "${bucket.name}" as a ${role}.</p>
             <p>Accept: ${process.env.CORS_ORIGIN ?? 'http://localhost:3000'}/invites/${rawToken}</p>`,
    });

    await auditService.record(invitedByUserId, 'bucket.invite', { type: 'Bucket', id: bucketId });
    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
  },

  async acceptInvite(token: string, acceptingUserId: string) {
    const invite = await prisma.bucketInvite.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw AppError.unauthorized('This invite is invalid or has expired', 'INVALID_INVITE');
    }

    const membership = await prisma.$transaction(async (tx) => {
      const created = await tx.bucketMember.upsert({
        where: { bucketId_userId: { bucketId: invite.bucketId, userId: acceptingUserId } },
        update: { role: invite.role, acceptedAt: new Date() },
        create: { bucketId: invite.bucketId, userId: acceptingUserId, role: invite.role, acceptedAt: new Date() },
      });
      await tx.bucketInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return created;
    });

    await auditService.record(acceptingUserId, 'bucket.invite.accept', { type: 'Bucket', id: invite.bucketId });
    return membership;
  },

  async listMembers(bucketId: string) {
    const members = await prisma.bucketMember.findMany({
      where: { bucketId },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { invitedAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      role: m.role,
      acceptedAt: m.acceptedAt,
      invitedAt: m.invitedAt,
    }));
  },

  async changeRole(bucketId: string, targetUserId: string, newRole: 'editor' | 'viewer') {
    const target = await prisma.bucketMember.findUnique({ where: { bucketId_userId: { bucketId, userId: targetUserId } } });
    if (!target) throw AppError.notFound('Member not found');

    if (target.role === 'owner' && (await countOwners(bucketId)) <= 1) {
      throw AppError.badRequest('A bucket must always have at least one owner', 'LAST_OWNER');
    }

    return prisma.bucketMember.update({ where: { bucketId_userId: { bucketId, userId: targetUserId } }, data: { role: newRole } });
  },

  async remove(bucketId: string, targetUserId: string, requestedBy: string) {
    const target = await prisma.bucketMember.findUnique({ where: { bucketId_userId: { bucketId, userId: targetUserId } } });
    if (!target) throw AppError.notFound('Member not found');

    if (target.role === 'owner' && (await countOwners(bucketId)) <= 1) {
      throw AppError.badRequest('A bucket must always have at least one owner', 'LAST_OWNER');
    }

    await prisma.bucketMember.delete({ where: { bucketId_userId: { bucketId, userId: targetUserId } } });
    await auditService.record(requestedBy, 'bucket.member.remove', { type: 'Bucket', id: bucketId });
  },
};
