import { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma';
import { AppError } from './errors';
import { asyncHandler } from './errorHandler';

export type BucketRole = 'viewer' | 'editor' | 'owner';

// The one place role-comparison ordering lives — every other module (bucket.service,
// membership.service) imports this instead of redefining the ranking.
export const ROLE_RANK: Record<BucketRole, number> = { viewer: 0, editor: 1, owner: 2 };

function resolveBucketId(req: Request): string | undefined {
  return (req.params.bucketId as string | undefined) ?? req.body?.bucketId ?? (req.query.bucketId as string | undefined);
}

// The one place bucket role comparison happens (docs/Phase3_Implementation_Plan.md §6.3) — every
// bucket-scoped route calls this instead of re-implementing "is this role high enough."
// Authorization always checks BucketMember, never Bucket.userId (see schema.prisma's comment on
// BucketMember) so a creator and an invited owner-equivalent are indistinguishable to this check.
export function requireBucketRole(minRole: BucketRole) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw AppError.unauthorized();
    const bucketId = resolveBucketId(req);
    if (!bucketId) throw AppError.badRequest('bucketId is required', 'MISSING_BUCKET_ID');

    const membership = await prisma.bucketMember.findUnique({
      where: { bucketId_userId: { bucketId, userId: req.auth.userId } },
    });

    if (!membership || ROLE_RANK[membership.role as BucketRole] < ROLE_RANK[minRole]) {
      throw AppError.forbidden('You do not have access to this bucket', 'BUCKET_ACCESS_DENIED');
    }

    req.bucketRole = membership.role as BucketRole;
    next();
  });
}

/** Optional variant for endpoints where an omitted bucketId means "no bucket filter" (e.g. list
 * endpoints scoped to "every bucket I can see") rather than a required parameter. */
export function optionalBucketRole(minRole: BucketRole) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw AppError.unauthorized();
    const bucketId = resolveBucketId(req);
    if (!bucketId) return next();
    return requireBucketRole(minRole)(req, _res, next);
  });
}

/** Every bucket the given user is at least a member of — the scope for "everything I can see"
 * queries (an omitted bucket filter on the memory list, cross-bucket suggestion visibility). */
export async function accessibleBucketIds(userId: string): Promise<string[]> {
  const memberships = await prisma.bucketMember.findMany({ where: { userId }, select: { bucketId: true } });
  return memberships.map((m) => m.bucketId);
}

/** Service-layer membership check for self-defending services (bucketAccess.ts's module
 * comment's discipline: a service re-checks even when route middleware already did). Phase 5/6
 * import this instead of each redefining their own copy of the check memory.service.ts already
 * has inline — the one place this specific shape of check lives going forward. */
export async function requireBucketMembership(
  userId: string,
  bucketId: string,
  minRole: BucketRole,
): Promise<{ bucketId: string; role: BucketRole }> {
  const membership = await prisma.bucketMember.findUnique({
    where: { bucketId_userId: { bucketId, userId } },
  });
  if (!membership || ROLE_RANK[membership.role as BucketRole] < ROLE_RANK[minRole]) {
    throw AppError.forbidden('You do not have access to this bucket', 'BUCKET_ACCESS_DENIED');
  }
  return { bucketId, role: membership.role as BucketRole };
}
