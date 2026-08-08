// The one message protocol content scripts and the popup use to reach the background service
// worker — neither ever calls the API directly (see manifest's host_permissions comment).
// Written stateless-per-message: every request carries everything the background needs, since
// MV3 can terminate and restart the worker between messages.

export type ExtensionMessage =
  | { type: "PAIRING_START" }
  | { type: "PAIRING_POLL"; code: string }
  | { type: "GET_CONNECTION_STATE" }
  | { type: "DISCONNECT" }
  | { type: "GET_ACCOUNT" }
  | { type: "UPDATE_AUTO_CAPTURE"; autoCapture: Record<string, boolean> }
  | { type: "UPDATE_SMART_MEMORY"; enabled: boolean }
  | { type: "GET_BUCKETS" }
  | { type: "ONE_CLICK_SAVE"; content: string; bucketId?: string }
  // `platform` is the active SiteAdapter's name — the same key account.autoCapture is keyed by,
  // so the server can enforce the per-platform consent toggle (US-ACC-07).
  | { type: "CAPTURE"; snippet: string; platform: string }
  | { type: "GET_PENDING_SUGGESTIONS" }
  | { type: "APPROVE_SUGGESTION"; id: string }
  | { type: "DISMISS_SUGGESTION"; id: string }
  | { type: "PREVIEW_CONTEXT"; snippet: string; bucketId?: string }
  | { type: "GET_RECENT_MEMORIES"; bucketId?: string; q?: string }
  | { type: "DELETE_MEMORY"; id: string };

export type ExtensionResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export function sendToBackground<T = unknown>(message: ExtensionMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: ExtensionResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("No response from background worker"));
        return;
      }
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    });
  });
}
