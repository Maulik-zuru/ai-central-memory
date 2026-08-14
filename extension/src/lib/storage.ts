// Key material lives in chrome.storage.session only — cleared on browser restart, forcing a
// lightweight re-pair rather than an API key persisting indefinitely in plain local storage
// (docs/Phase8_BrowserExtension_Implementation_Plan.md §6.2). Non-secret prefs use
// chrome.storage.local so they survive a restart.

const SESSION_KEY = "apiKey";
const PENDING_PAIRING_KEY = "pendingPairing";
const LOCAL_PREFS_KEY = "prefs";

export interface Prefs {
  lastBucketId?: string;
  // Phase 22: off by default until the countdown UX is verified not to surprise users (the plan's
  // own delivery order calls this out explicitly), so its absence must read as "off," not "on."
  autoInjectCountdown?: boolean;
  // Phase 22: whole-conversation chat-history capture is a bigger data-collection step than
  // extracting individual memories — opt-in, off by default, toggled from the popup's Sync tab.
  chatHistorySyncEnabled?: boolean;
  // Phase 22: the floating button's remembered position, keyed by SiteAdapter.name — a flat
  // Prefs merge (see setPrefs below) can't deep-merge this, so callers read-modify-write the
  // whole map themselves (e.g. `setPrefs({ buttonPosition: { ...current.buttonPosition, [site]: pos } })`).
  buttonPosition?: Record<string, { x: number; y: number }>;
}

// A pairing attempt in flight, persisted so it survives the action popup closing — which Chrome
// does the instant the dashboard tab it opens takes focus (see background/pairing.ts). Session
// storage is the right lifetime here too: if the browser restarts mid-pairing, the code's own
// server-side TTL will have long since made it moot anyway.
export interface PendingPairing {
  code: string;
  expiresAt: string;
}

export async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (result[SESSION_KEY] as string | undefined) ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: key });
}

export async function clearApiKey(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function getPendingPairing(): Promise<PendingPairing | null> {
  const result = await chrome.storage.session.get(PENDING_PAIRING_KEY);
  return (result[PENDING_PAIRING_KEY] as PendingPairing | undefined) ?? null;
}

export async function setPendingPairing(pairing: PendingPairing): Promise<void> {
  await chrome.storage.session.set({ [PENDING_PAIRING_KEY]: pairing });
}

export async function clearPendingPairing(): Promise<void> {
  await chrome.storage.session.remove(PENDING_PAIRING_KEY);
}

export async function getPrefs(): Promise<Prefs> {
  const result = await chrome.storage.local.get(LOCAL_PREFS_KEY);
  return (result[LOCAL_PREFS_KEY] as Prefs | undefined) ?? {};
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  const current = await getPrefs();
  await chrome.storage.local.set({ [LOCAL_PREFS_KEY]: { ...current, ...patch } });
}
