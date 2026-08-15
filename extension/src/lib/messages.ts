// The one message protocol content scripts and the popup use to reach the background service
// worker — neither ever calls the API directly (see manifest's host_permissions comment).
// Written stateless-per-message: every request carries everything the background needs, since
// MV3 can terminate and restart the worker between messages.

export type ExtensionMessage =
  | { type: "PAIRING_START" }
  // No `code` — the background worker tracks the pending pairing itself (chrome.storage.session),
  // so this can be sent right after PAIRING_START or blind, on popup mount, to ask "how did it go
  // while I was closed?" (see background/pairing.ts).
  | { type: "CHECK_PAIRING" }
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
  // Bulk review — a busy conversation can leave several capture suggestions pending at once
  // (one per turn, sometimes more than one per turn), and reviewing them one at a time is the
  // exact friction these exist to remove. Same ids-array shape as the single actions above.
  | { type: "APPROVE_SUGGESTIONS"; ids: string[] }
  | { type: "DISMISS_SUGGESTIONS"; ids: string[] }
  | { type: "PREVIEW_CONTEXT"; snippet: string; bucketId?: string }
  | { type: "GET_RECENT_MEMORIES"; bucketId?: string; q?: string }
  | { type: "DELETE_MEMORY"; id: string }
  | { type: "GET_ONBOARDING_STATE" }
  | { type: "DISMISS_ONBOARDING" }
  | { type: "REPLAY_ONBOARDING" }
  // Phase 22 (MemoryPlugin_Clone_Spec.md §5.4 "online sync — no export file needed"): pushes the
  // active tab's conversation transcript into the chat-history archive via the same
  // ingest/custom-online endpoint the programmatic API uses — upserted by conversationId, so
  // re-sending the same conversation as it grows never duplicates.
  | {
      type: "INGEST_CONVERSATION";
      bucketId: string;
      platform: string;
      conversationId: string;
      title: string;
      messages: { role: "user" | "assistant"; content: string }[];
    }
  | { type: "GET_CONVERSATIONS" };

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
