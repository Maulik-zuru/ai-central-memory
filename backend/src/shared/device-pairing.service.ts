import crypto from 'crypto';
import { prisma } from './prisma';
import { AppError } from './errors';
import { apiKeyService } from '../modules/apikey/apikey.service';

// Extracted from modules/extension/extension-pairing.service.ts in Phase 13
// (docs/Phase13_DesktopAgent_Implementation_Plan.md §6.2). The browser extension and the desktop
// agent pair identically — a short-lived code, an explicit dashboard confirmation, a scoped key
// handed over exactly once — so the semantics live here once instead of being copied and drifting.
// A future third client (a CLI, a mobile app) is a config object, not another copy of this file.

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I/L/O/U — typo-resistant
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;

export interface PairingClientConfig {
  /** Stored on the code row; a code minted for one client cannot be used by another. */
  client: string;
  /** Scopes the issued key carries. Must never include apikey:manage. */
  scopes: string[];
  /** Human-readable ApiKey name, shown in Settings → API Keys. */
  keyName(context: PairingClaimContext): string;
}

/** Client-supplied detail about the machine being paired. Free-form; only `keyName` reads it. */
export type PairingClaimContext = Record<string, string | undefined>;

export interface PairingClaimResult {
  apiKeyId: string;
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CROCKFORD_ALPHABET[bytes[i] % CROCKFORD_ALPHABET.length];
  }
  return code;
}

export function createPairingService(config: PairingClientConfig) {
  return {
    scopes: config.scopes,

    async start(): Promise<{ code: string; expiresAt: Date }> {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      await prisma.devicePairingCode.create({ data: { code, client: config.client, expiresAt } });
      return { code, expiresAt };
    },

    // Dashboard-side, requires an active session — never an API key, since a key can't authorize
    // minting another key. The raw key is stashed on the pairing row for the client's status()
    // poll to pick up (see the model comment) and is not otherwise returned to the caller.
    //
    // `onIssued` runs inside the same transaction-shaped step as the key issue so a client that
    // needs its own bookkeeping (the desktop agent's DesktopAgentDevice row) cannot end up with a
    // key that no device row points at.
    async claim(
      userId: string,
      code: string,
      context: PairingClaimContext = {},
      onIssued?: (apiKeyId: string, context: PairingClaimContext) => Promise<void>,
    ): Promise<PairingClaimResult> {
      const pairing = await prisma.devicePairingCode.findUnique({ where: { code } });
      // A code minted by a different client is treated as invalid rather than "wrong client" —
      // same reasoning as apiKeyService.revoke returning 404 for another user's key: no
      // existence leak, and no path where a desktop code yields extension scopes.
      if (
        !pairing ||
        pairing.client !== config.client ||
        pairing.consumedAt ||
        pairing.expiresAt < new Date()
      ) {
        throw AppError.badRequest('This pairing code is invalid or has expired', 'INVALID_PAIRING_CODE');
      }

      const issued = await apiKeyService.issue(userId, config.keyName(context), config.scopes);

      if (onIssued) {
        try {
          await onIssued(issued.id, context);
        } catch (error) {
          // The key exists but its owner-side record does not. Revoke it rather than leave a live
          // credential nobody can see or manage.
          await apiKeyService.revoke(userId, issued.id);
          throw error;
        }
      }

      await prisma.devicePairingCode.update({
        where: { code },
        data: { userId, consumedAt: new Date(), deliveredKey: issued.key },
      });

      return { apiKeyId: issued.id };
    },

    // The client polls this after opening the dashboard's connect tab. The key is only ever
    // returned on the first poll after a claim — `deliveredKey` is cleared the instant it's read,
    // so a second poll (or a replayed response) reports `expired` rather than handing the key out
    // twice.
    async status(code: string): Promise<{ status: 'pending' | 'claimed' | 'expired'; key?: string }> {
      const pairing = await prisma.devicePairingCode.findUnique({ where: { code } });
      if (!pairing || pairing.client !== config.client || pairing.expiresAt < new Date()) {
        return { status: 'expired' };
      }
      if (!pairing.consumedAt) return { status: 'pending' };
      if (!pairing.deliveredKey) return { status: 'expired' };

      const key = pairing.deliveredKey;
      await prisma.devicePairingCode.update({
        where: { code },
        data: { deliveredKey: null, deliveredAt: new Date() },
      });
      return { status: 'claimed', key };
    },
  };
}

export type PairingService = ReturnType<typeof createPairingService>;
