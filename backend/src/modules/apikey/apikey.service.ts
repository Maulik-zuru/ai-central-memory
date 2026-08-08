import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { generateApiKey } from '../../shared/tokens';
import { auditService } from '../audit/audit.service';

function toPublicKey(key: {
  id: string;
  name: string;
  keyPreview: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: key.id,
    name: key.name,
    preview: key.keyPreview,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt,
    revoked: key.revokedAt !== null,
    createdAt: key.createdAt,
  };
}

// Deep module: callers never see keyHash, never construct the raw key themselves, and never see a
// raw key again after issue() returns (US-ACC-03 AC).
export const apiKeyService = {
  async issue(userId: string, name: string, scopes: string[]) {
    const { raw, hash, preview } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: { userId, name, keyHash: hash, keyPreview: preview, scopes },
    });
    await auditService.record(userId, 'apikey.issue', { type: 'ApiKey', id: key.id });
    return { ...toPublicKey(key), key: raw };
  },

  async list(userId: string) {
    const keys = await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return keys.map(toPublicKey);
  },

  async revoke(userId: string, keyId: string) {
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) {
      throw AppError.notFound('API key not found');
    }
    if (key.revokedAt) return toPublicKey(key); // idempotent

    const updated = await prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    await auditService.record(userId, 'apikey.revoke', { type: 'ApiKey', id: keyId });
    return toPublicKey(updated);
  },
};
