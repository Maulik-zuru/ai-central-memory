// Key material lives in chrome.storage.session only — cleared on browser restart, forcing a
// lightweight re-pair rather than an API key persisting indefinitely in plain local storage
// (docs/Phase8_BrowserExtension_Implementation_Plan.md §6.2). Non-secret prefs use
// chrome.storage.local so they survive a restart.

const SESSION_KEY = "apiKey";
const LOCAL_PREFS_KEY = "prefs";

interface Prefs {
  lastBucketId?: string;
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

export async function getPrefs(): Promise<Prefs> {
  const result = await chrome.storage.local.get(LOCAL_PREFS_KEY);
  return (result[LOCAL_PREFS_KEY] as Prefs | undefined) ?? {};
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  const current = await getPrefs();
  await chrome.storage.local.set({ [LOCAL_PREFS_KEY]: { ...current, ...patch } });
}
