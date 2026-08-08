import { Router } from 'express';
import { authenticate } from '../../shared/authenticate';
import { apiRateLimit } from '../../shared/rateLimit';
import { asyncHandler } from '../../shared/errorHandler';
import { requireBucketRole } from '../../shared/bucketAccess';
import { bucketController } from './bucket.controller';
import { membershipController } from '../membership/membership.controller';

export const bucketRouter = Router();

bucketRouter.use(authenticate);
bucketRouter.use(apiRateLimit);
bucketRouter.post('/', asyncHandler(bucketController.create));
bucketRouter.get('/', asyncHandler(bucketController.list));
bucketRouter.patch('/:bucketId', requireBucketRole('owner'), asyncHandler(bucketController.update));
bucketRouter.delete('/:bucketId', requireBucketRole('owner'), asyncHandler(bucketController.remove));

bucketRouter.post('/:bucketId/invites', requireBucketRole('owner'), asyncHandler(membershipController.invite));
bucketRouter.get('/:bucketId/members', requireBucketRole('viewer'), asyncHandler(membershipController.listMembers));
bucketRouter.patch(
  '/:bucketId/members/:userId',
  requireBucketRole('owner'),
  asyncHandler(membershipController.changeRole),
);
bucketRouter.delete(
  '/:bucketId/members/:userId',
  requireBucketRole('owner'),
  asyncHandler(membershipController.removeMember),
);
