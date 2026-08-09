import os from 'node:os';
import { shell } from 'electron';
import { API_BASE_URL, DASHBOARD_URL } from './config';

/**
 * The agent side of US-INT-07's "explicit, visible authorization step (no silent background
 * enrollment)".
 *
 * Identical in shape to the browser extension's flow (Phase 8): mint a short-lived code, open the
 * dashboard in the user's own browser, and poll until a human clicks Connect there. The agent
 * cannot authorize itself — the claim endpoint requires a logged-in session, so a machine with no
 * browser session simply cannot pair, by design.
 */

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // matches the server's pairing TTL

export interface PairingHandle {
  code: string;
  expiresAt: string;
  /** Resolves with the raw key on success, or null if the code expired without being claimed. */
  completed: Promise<string | null>;
  cancel(): void;
}

export function defaultDeviceName(): string {
  return `${os.hostname().replace(/\.local$/, '')}`;
}

export async function startPairing(
  appVersion: string,
  deviceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PairingHandle> {
  const started = await fetchImpl(`${API_BASE_URL}/api/desktop/pairing/start`, { method: 'POST' });
  if (!started.ok) throw new Error(`Could not start pairing (${started.status})`);
  const { code, expiresAt } = (await started.json()) as { code: string; expiresAt: string };

  // The device name and platform ride along in the URL so the dashboard can name what it is about
  // to authorize. They are advisory: the server takes them from the claim body, which the
  // dashboard sends, so a user who is uneasy about what they see can simply cancel.
  const params = new URLSearchParams({
    pair: code,
    name: deviceName,
    platform: process.platform,
    version: appVersion,
  });
  await shell.openExternal(`${DASHBOARD_URL}/dashboard/settings/devices?${params.toString()}`);

  let cancelled = false;
  const completed = (async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (!cancelled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelled) return null;
      try {
        const res = await fetchImpl(`${API_BASE_URL}/api/desktop/pairing/status?code=${code}`);
        const body = (await res.json()) as { status: string; key?: string };
        if (body.status === 'claimed' && body.key) return body.key;
        if (body.status === 'expired') return null;
      } catch {
        // Transient network trouble while the user is mid-click. Keep polling until the code's
        // own TTL runs out rather than failing the whole flow on one dropped request.
        continue;
      }
    }
    return null;
  })();

  return {
    code,
    expiresAt,
    completed,
    cancel() {
      cancelled = true;
    },
  };
}

export async function sendHeartbeat(key: string, appVersion: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${API_BASE_URL}/api/desktop/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ appVersion, osVersion: os.release() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
