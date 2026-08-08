import crypto from 'crypto';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { apiKeyService } from '../apikey/apikey.service';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I/L/O/U — typo-resistant
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;

// Deliberately excludes apikey:manage, account:delete, and any future billing scope — an
// extension-issued key must never be usable to mint further keys, manage billing, or delete the
// account, even if a bug in the extension tried (Phase8_BrowserExtension_Implementation_Plan.md
// §5.1).
export const EXTENSION_SCOPES = [
  'memory:write',
  'memory:read',
  'context:read',
  'bucket:read',
  'suggestion:read',
  'suggestion:write',
  'account:read',
];

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CROCKFORD_ALPHABET[bytes[i] % CROCKFORD_ALPHABET.length];
  }
  return code;
}

export const extensionPairingService = {
  async start(): Promise<{ code: string; expiresAt: Date }> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    await prisma.extensionPairingCode.create({ data: { code, expiresAt } });
    return { code, expiresAt };
  },

  // Dashboard-side, requires an active session — never an API key, since a key can't authorize
  // minting another key. The raw key is stashed on the pairing row for the extension's status()
  // poll to pick up (see the model comment) and is not otherwise returned to the caller — the
  // dashboard only needs to know the claim succeeded to render its confirmation.
  async claim(userId: string, code: string): Promise<{ apiKeyId: string }> {
    const pairing = await prisma.extensionPairingCode.findUnique({ where: { code } });
    if (!pairing || pairing.consumedAt || pairing.expiresAt < new Date()) {
      throw AppError.badRequest('This pairing code is invalid or has expired', 'INVALID_PAIRING_CODE');
    }

    const issued = await apiKeyService.issue(
      userId,
      `Browser Extension — Chrome (${new Date().toISOString().slice(0, 10)})`,
      EXTENSION_SCOPES,
    );

    await prisma.extensionPairingCode.update({
      where: { code },
      data: { userId, consumedAt: new Date(), deliveredKey: issued.key },
    });

    return { apiKeyId: issued.id };
  },

  // The extension polls this after opening the dashboard's connect tab. The key is only ever
  // returned on the first poll after a claim — `deliveredKey` is cleared the instant it's read,
  // so a second poll (or a replayed response) reports `expired` rather than handing the key out
  // twice.
  async status(code: string): Promise<{ status: 'pending' | 'claimed' | 'expired'; key?: string }> {
    const pairing = await prisma.extensionPairingCode.findUnique({ where: { code } });
    if (!pairing || pairing.expiresAt < new Date()) return { status: 'expired' };
    if (!pairing.consumedAt) return { status: 'pending' };
    if (!pairing.deliveredKey) return { status: 'expired' };

    const key = pairing.deliveredKey;
    await prisma.extensionPairingCode.update({
      where: { code },
      data: { deliveredKey: null, deliveredAt: new Date() },
    });
    return { status: 'claimed', key };
  },
};
