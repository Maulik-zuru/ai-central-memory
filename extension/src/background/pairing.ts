import { backgroundApi } from "./api";
import { clearPendingPairing, getPendingPairing, setApiKey, setPendingPairing } from "../lib/storage";

// Chrome closes an extension's action popup the instant it loses focus — which happens the moment
// the dashboard tab opened by `startPairing` becomes the active tab. A poll loop living inside the
// popup's own React component is therefore torn down before it can ever observe the pairing being
// claimed: the dashboard shows "Connected", the popup shows "Connect" forever, and the delivered
// key is never fetched (the server hands it out exactly once — see extension-pairing.service.ts).
//
// The fix is that nothing pairing-related may depend on the popup staying open. Pending pairing
// state lives in storage, `chrome.alarms` — not a popup-owned timer — drives the durable retry,
// and the popup's UI is a passive reflection of state it reads on mount, never the thing doing the
// polling itself.

export const PAIRING_ALARM_NAME = "pairing-poll";

export type PairingCheckResult = { status: "pending" | "claimed" | "expired" | "none" };

/**
 * The single place that decides what a pairing status transition means for stored state. Called
 * both by the alarm (the durable path) and on-demand by the popup (for a faster-feeling UI when
 * it happens to be open) — whichever caller runs first just means the other does nothing.
 */
export async function checkPendingPairing(): Promise<PairingCheckResult> {
  const pending = await getPendingPairing();
  if (!pending) {
    // Nothing to check — an orphaned alarm (e.g. one left over after `chrome.storage.session` was
    // cleared by a browser restart) would otherwise fire forever for no reason.
    await chrome.alarms.clear(PAIRING_ALARM_NAME);
    return { status: "none" };
  }

  if (new Date(pending.expiresAt).getTime() < Date.now()) {
    await clearPendingPairing();
    await chrome.alarms.clear(PAIRING_ALARM_NAME);
    return { status: "expired" };
  }

  const result = await backgroundApi.pollPairing(pending.code);

  if (result.status === "claimed") {
    await setApiKey(result.key);
    await clearPendingPairing();
    await chrome.alarms.clear(PAIRING_ALARM_NAME);
    return { status: "claimed" };
  }

  if (result.status === "expired") {
    await clearPendingPairing();
    await chrome.alarms.clear(PAIRING_ALARM_NAME);
    return { status: "expired" };
  }

  return { status: "pending" };
}

export async function startPairing(): Promise<{ code: string; expiresAt: string }> {
  const result = await backgroundApi.startPairing();
  await setPendingPairing({ code: result.code, expiresAt: result.expiresAt });
  // 1 minute is Chrome's floor for a repeating alarm in a packed extension — well inside the
  // server's 10-minute pairing TTL, so this gets several checks in before the code expires. This
  // alarm, not the popup, is what makes pairing complete.
  chrome.alarms.create(PAIRING_ALARM_NAME, { periodInMinutes: 1 });
  return result;
}
