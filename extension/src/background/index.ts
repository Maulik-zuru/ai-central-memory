import { backgroundApi } from "./api";
import { checkPendingPairing, PAIRING_ALARM_NAME, startPairing } from "./pairing";
import { clearApiKey, getApiKey } from "../lib/storage";
import { dismissOnboarding, getOnboardingState, replayOnboarding } from "../lib/onboarding";
import type { ExtensionMessage, ExtensionResponse } from "../lib/messages";

// Written stateless-per-message throughout (docs/Phase8_BrowserExtension_Implementation_Plan.md
// §6.2): MV3 can terminate and restart this worker between messages, so nothing relevant is held
// in module-level memory that isn't also durably in chrome.storage.

async function handle(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "PAIRING_START":
      return startPairing();

    // No `code` on this message: the pending code lives in storage (see background/pairing.ts),
    // so a popup that reopens after being closed mid-pairing can still ask "how did it go?"
    // without having held onto anything itself.
    case "CHECK_PAIRING":
      return checkPendingPairing();

    case "GET_CONNECTION_STATE": {
      const apiKey = await getApiKey();
      return { connected: Boolean(apiKey) };
    }

    case "DISCONNECT": {
      const { apiKeys } = await backgroundApi.listApiKeys();
      const extensionKey = apiKeys.find((k) => k.name.startsWith("Browser Extension") && !k.revoked);
      if (extensionKey) await backgroundApi.revokeApiKey(extensionKey.id);
      await clearApiKey();
      return { disconnected: true };
    }

    case "GET_ACCOUNT":
      return backgroundApi.getAccount();

    case "UPDATE_AUTO_CAPTURE":
      return backgroundApi.updateAutoCapture(message.autoCapture);

    case "UPDATE_SMART_MEMORY":
      return backgroundApi.updateSmartMemory(message.enabled);

    case "GET_BUCKETS":
      return backgroundApi.getBuckets();

    case "ONE_CLICK_SAVE":
      return backgroundApi.oneClickSave(message.content, message.bucketId);

    case "CAPTURE":
      return backgroundApi.capture(message.snippet, message.platform);

    case "GET_PENDING_SUGGESTIONS":
      return backgroundApi.getPendingSuggestions();

    case "APPROVE_SUGGESTION":
      return backgroundApi.approveSuggestion(message.id);

    case "DISMISS_SUGGESTION":
      return backgroundApi.dismissSuggestion(message.id);

    case "PREVIEW_CONTEXT":
      return backgroundApi.previewContext(message.snippet, message.bucketId);

    case "GET_RECENT_MEMORIES":
      return backgroundApi.getRecentMemories(message.bucketId, message.q);

    case "DELETE_MEMORY":
      return backgroundApi.deleteMemory(message.id);

    case "GET_ONBOARDING_STATE":
      return getOnboardingState();

    case "DISMISS_ONBOARDING":
      return dismissOnboarding();

    case "REPLAY_ONBOARDING":
      return replayOnboarding();

    case "INGEST_CONVERSATION":
      return backgroundApi.ingestConversation(
        message.bucketId,
        message.platform,
        message.conversationId,
        message.title,
        message.messages,
      );

    case "GET_CONVERSATIONS":
      return backgroundApi.getConversations();
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data } satisfies ExtensionResponse))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : "Unknown error" } satisfies ExtensionResponse),
    );
  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.set({ onboardingPending: true });
  }
});

// The durable half of pairing: fires on Chrome's schedule regardless of whether the popup that
// started pairing is still open — which by the time this alarm exists, it almost certainly is
// not (see background/pairing.ts for why).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PAIRING_ALARM_NAME) void checkPendingPairing();
});
