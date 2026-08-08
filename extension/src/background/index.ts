import { backgroundApi } from "./api";
import { clearApiKey, getApiKey, setApiKey } from "../lib/storage";
import type { ExtensionMessage, ExtensionResponse } from "../lib/messages";

// Written stateless-per-message throughout (docs/Phase8_BrowserExtension_Implementation_Plan.md
// §6.2): MV3 can terminate and restart this worker between messages, so nothing relevant is held
// in module-level memory that isn't also durably in chrome.storage.

async function handle(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "PAIRING_START":
      return backgroundApi.startPairing();

    case "PAIRING_POLL": {
      const result = await backgroundApi.pollPairing(message.code);
      if (result.status === "claimed") await setApiKey(result.key);
      return result;
    }

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
      return backgroundApi.capture(message.snippet);

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
