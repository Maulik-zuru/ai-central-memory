import { createPairingService } from '../../shared/device-pairing.service';

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

// Phase 13 extracted the mechanics (code generation, TTL, one-shot key delivery, replay
// protection) into shared/device-pairing.service.ts so the desktop agent pairs the same way
// rather than a second way. This module keeps its name and its exported surface — nothing
// downstream of it changed.
export const extensionPairingService = createPairingService({
  client: 'extension',
  scopes: EXTENSION_SCOPES,
  keyName: () => `Browser Extension — Chrome (${new Date().toISOString().slice(0, 10)})`,
});
