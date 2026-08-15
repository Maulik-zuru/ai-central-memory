import { API_BASE_URL } from "../lib/config";
import { getApiKey } from "../lib/storage";
import type {
  Account,
  ApiKeySummary,
  Bucket,
  ContextPreview,
  ConversationSummary,
  Memory,
  PairingStartResult,
  PairingStatus,
  Suggestion,
} from "../lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// The only place in the extension that ever calls the API directly — the background service
// worker holds host_permissions for it (manifest.config.ts), so this fetch is exempt from
// browser-enforced CORS. Content scripts and the popup only ever reach this via message relay.
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiKey = await getApiKey();
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("content-type", "application/json");
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? "Request failed");
  return body as T;
}

export const backgroundApi = {
  startPairing: () => apiFetch<PairingStartResult>("/api/extension/pairing/start", { method: "POST" }),

  pollPairing: (code: string) => apiFetch<PairingStatus>(`/api/extension/pairing/status?code=${code}`),

  getAccount: () => apiFetch<{ account: Account }>("/api/account/me"),

  updateAutoCapture: (autoCapture: Record<string, boolean>) =>
    apiFetch("/api/account/auto-capture", { method: "PATCH", body: JSON.stringify({ autoCapture }) }),

  updateSmartMemory: (enabled: boolean) =>
    apiFetch("/api/account/smart-memory", { method: "PATCH", body: JSON.stringify({ enabled }) }),

  getBuckets: () => apiFetch<{ buckets: Bucket[] }>("/api/buckets"),

  oneClickSave: (content: string, bucketId?: string) =>
    apiFetch<{ memory: Memory }>("/api/memories/one-click", { method: "POST", body: JSON.stringify({ content, bucketId }) }),

  // Phase 18 (§7.4): fire-and-forget server-side — the extraction LLM call no longer blocks the
  // response, so this only acknowledges the snippet was queued. Callers poll
  // `getPendingSuggestions` for the suggestion it produces, if any.
  capture: (snippet: string, platform: string) =>
    apiFetch<{ status: "queued" }>("/api/capture", {
      method: "POST",
      body: JSON.stringify({ snippet, platform }),
    }),

  getPendingSuggestions: () => apiFetch<{ suggestions: Suggestion[] }>("/api/suggestions"),

  approveSuggestion: (id: string) => apiFetch<{ suggestion: Suggestion }>(`/api/suggestions/${id}/approve`, { method: "POST" }),

  dismissSuggestion: (id: string) => apiFetch<{ suggestion: Suggestion }>(`/api/suggestions/${id}/dismiss`, { method: "POST" }),

  approveSuggestions: (ids: string[]) =>
    apiFetch<{ approved: number; failed: string[] }>("/api/suggestions/approve-many", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  dismissSuggestions: (ids: string[]) =>
    apiFetch<{ dismissed: number; failed: string[] }>("/api/suggestions/dismiss-many", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  previewContext: (snippet: string, bucketId?: string) =>
    apiFetch<ContextPreview>("/api/context/preview", {
      method: "POST",
      body: JSON.stringify({ snippet, bucketId }),
    }),

  getRecentMemories: (bucketId?: string, q?: string) => {
    const search = new URLSearchParams();
    search.set("limit", "20");
    if (bucketId) search.set("bucketId", bucketId);
    if (q) search.set("q", q);
    return apiFetch<{ items: Memory[] }>(`/api/memories?${search.toString()}`);
  },

  deleteMemory: (id: string) => apiFetch<void>(`/api/memories/${id}`, { method: "DELETE" }),

  listApiKeys: () => apiFetch<{ apiKeys: ApiKeySummary[] }>("/api/keys"),

  revokeApiKey: (apiKeyId: string) => apiFetch<void>(`/api/keys/${apiKeyId}`, { method: "DELETE" }),

  // Phase 22: same upsert-by-conversation.id contract the programmatic API uses (Phase 15) —
  // re-sending the same conversationId as it grows updates in place, never duplicates. bucketId
  // is required by the endpoint itself (chat-history.types.ts's ingestCustomOnlineSchema).
  ingestConversation: (
    bucketId: string,
    platform: string,
    conversationId: string,
    title: string,
    messages: { role: "user" | "assistant"; content: string }[],
  ) =>
    apiFetch<{ status: "queued" | "skipped" }>("/api/chat-history/ingest/custom-online", {
      method: "POST",
      body: JSON.stringify({ bucketId, platform, conversation: { id: conversationId, title, messages } }),
    }),

  getConversations: () => apiFetch<{ items: ConversationSummary[] }>("/api/chat-history/conversations?limit=20"),
};
