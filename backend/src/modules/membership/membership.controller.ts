import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { membershipService } from './membership.service';
import { changeRoleSchema, inviteSchema } from '../bucket/bucket.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const membershipController = {
  async invite(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { email, role } = inviteSchema.parse(req.body);
    const invite = await membershipService.invite(req.params.bucketId, userId, email, role);
    res.status(201).json({ invite });
  },

  async listMembers(req: Request, res: Response) {
    const members = await membershipService.listMembers(req.params.bucketId);
    res.status(200).json({ members });
  },

  async changeRole(req: Request, res: Response) {
    const { role } = changeRoleSchema.parse(req.body);
    const member = await membershipService.changeRole(req.params.bucketId, req.params.userId, role);
    res.status(200).json({ member });
  },

  async removeMember(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    await membershipService.remove(req.params.bucketId, req.params.userId, userId);
    res.status(204).send();
  },
};
