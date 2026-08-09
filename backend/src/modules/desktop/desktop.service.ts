import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { createPairingService } from '../../shared/device-pairing.service';
import { apiKeyService } from '../apikey/apikey.service';
import { auditService } from '../audit/audit.service';

// Same exclusions as EXTENSION_SCOPES, for the same reason: a device-issued key must never be
// usable to mint further keys, manage billing, or delete the account
// (docs/Phase13_DesktopAgent_Implementation_Plan.md §6.2). The desktop agent needs exactly what
// the extension needs — it captures snippets and reads context, nothing more.
export const DESKTOP_AGENT_SCOPES = [
  'memory:write',
  'memory:read',
  'context:read',
  'bucket:read',
  'suggestion:read',
  'suggestion:write',
  'account:read',
];

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', win32: 'Windows' };

export const desktopPairingService = createPairingService({
  client: 'desktop',
  scopes: DESKTOP_AGENT_SCOPES,
  keyName: (ctx) =>
    `Desktop Agent — ${ctx.deviceName ?? 'Unknown device'} (${PLATFORM_LABEL[ctx.platform ?? ''] ?? ctx.platform ?? 'unknown'})`,
});

function toPublicDevice(device: {
  id: string;
  name: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    osVersion: device.osVersion,
    appVersion: device.appVersion,
    lastSeenAt: device.lastSeenAt,
    revoked: device.revokedAt !== null,
    createdAt: device.createdAt,
  };
}

export const desktopService = {
  async claim(
    userId: string,
    input: { code: string; deviceName: string; platform: string; osVersion?: string; appVersion?: string },
  ) {
    let deviceId = '';
    // The device row is created by the pairing service's onIssued hook, which revokes the key if
    // this throws — so there is no path to a live key with no device row behind it.
    const { apiKeyId } = await desktopPairingService.claim(
      userId,
      input.code,
      {
        deviceName: input.deviceName,
        platform: input.platform,
        osVersion: input.osVersion,
        appVersion: input.appVersion,
      },
      async (issuedKeyId) => {
        const device = await prisma.desktopAgentDevice.create({
          data: {
            userId,
            name: input.deviceName,
            platform: input.platform,
            osVersion: input.osVersion ?? null,
            appVersion: input.appVersion ?? null,
            apiKeyId: issuedKeyId,
          },
        });
        deviceId = device.id;
      },
    );

    await auditService.record(userId, 'desktop.device.pair', { type: 'DesktopAgentDevice', id: deviceId });
    return { apiKeyId, deviceId };
  },

  async list(userId: string) {
    const devices = await prisma.desktopAgentDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return devices.map(toPublicDevice);
  },

  // Revoking the device revokes the key it authenticates with — that is what makes revocation
  // mean something to a machine that is currently running. A device belonging to someone else is
  // reported as not found rather than forbidden, matching apiKeyService.revoke: no existence leak.
  async revoke(userId: string, deviceId: string) {
    const device = await prisma.desktopAgentDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.userId !== userId) throw AppError.notFound('Device not found');
    if (device.revokedAt) return toPublicDevice(device); // idempotent

    if (device.apiKeyId) {
      const key = await prisma.apiKey.findUnique({ where: { id: device.apiKeyId } });
      if (key && !key.revokedAt) await apiKeyService.revoke(userId, device.apiKeyId);
    }

    const updated = await prisma.desktopAgentDevice.update({
      where: { id: deviceId },
      data: { revokedAt: new Date() },
    });
    await auditService.record(userId, 'desktop.device.revoke', { type: 'DesktopAgentDevice', id: deviceId });
    return toPublicDevice(updated);
  },

  // Agent-authenticated. The device is resolved from the key doing the calling, so an agent can
  // only ever stamp its own row — there is no device id in the request to tamper with.
  async heartbeat(apiKeyId: string, input: { appVersion?: string; osVersion?: string }) {
    const device = await prisma.desktopAgentDevice.findUnique({ where: { apiKeyId } });
    if (!device || device.revokedAt) throw AppError.notFound('Device not found');

    const updated = await prisma.desktopAgentDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        appVersion: input.appVersion ?? device.appVersion,
        osVersion: input.osVersion ?? device.osVersion,
      },
    });
    return toPublicDevice(updated);
  },
};
