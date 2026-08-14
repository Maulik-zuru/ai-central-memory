import { apiRequest, apiRequestBlob } from "./api-client";

export interface Account {
  id: string;
  email: string;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
  autoCapture: Record<string, boolean>;
  smartMemoryEnabled: boolean;
  hasSeenTour: boolean;
  /** False when this deployment runs free — the whole billing surface hides. */
  paymentsEnabled: boolean;
  subscription: { plan: string; status: string; trialEndsAt: string | null } | null;
}

export interface ApiKey {
  id: string;
  name: string;
  preview: string;
  scopes: string[];
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
}

// Phase 13 (US-INT-07): a paired desktop agent. `revoked` is the only state that matters to the
// UI — a revoked device keeps its row so the list shows what was disconnected and when.
export interface DesktopDevice {
  id: string;
  name: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface DesktopPairingClaim {
  code: string;
  deviceName: string;
  platform: string;
  osVersion?: string;
  appVersion?: string;
}

export interface Memory {
  id: string;
  bucketId: string;
  type: "text" | "image";
  content: string;
  imageUrl: string | null;
  source: "manual" | "one_click" | "auto";
  status: "active" | "stale" | "merged" | "deleted";
  mergedIntoId: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryPage {
  items: Memory[];
  nextCursor: string | null;
}

export interface MemoryVersion {
  id: string;
  memoryId: string;
  content: string;
  changedBy: string;
  changeType: "create" | "edit" | "merge";
  createdAt: string;
}

// Phase 19 (ADR-0004 "Memory Suggestions curator"): the curator's three operation types.
// memoryIds[0] is always the primary target — the memory removed, rewritten in place (update), or
// the chosen survivor (combine, which lists every absorbed memory after it). bucketId is resolved
// server-side from that primary memory (null for "capture", which has no memory yet).
export interface Suggestion {
  id: string;
  type: "remove" | "combine" | "update" | "capture";
  memoryIds: string[];
  draftContent: string | null;
  status: "pending" | "approved" | "dismissed";
  bucketId: string | null;
  createdAt: string;
}

export type BucketRole = "owner" | "editor" | "viewer";

export interface Bucket {
  id: string;
  name: string;
  isDefault: boolean;
  parentId: string | null;
  role: BucketRole;
  createdAt: string;
}

export interface BucketMember {
  userId: string;
  email: string;
  role: BucketRole;
  invitedAt: string;
  acceptedAt: string | null;
}

export interface Category {
  id: string;
  userId: string;
  label: string;
  memoryCount: number;
  createdAt: string;
}

export interface ContextMemory {
  id: string;
  content: string;
  categoryId: string | null;
  score: number;
  createdAt: string;
}

export interface ContextPreview {
  smartModeEnabled: boolean;
  memories: ContextMemory[];
  actualTokens: number;
  everythingTokens: number;
  tokenBudget: number;
}

export type ProcessingStatus = "processing" | "importing" | "ready" | "error";

export interface Conversation {
  id: string;
  bucketId: string;
  platform: string;
  title: string;
  summary: string | null;
  messageCount: number;
  status: ProcessingStatus;
  errorReason: string | null;
  importedAt: string;
  lastSyncedAt: string;
}

export interface ConversationPage {
  items: Conversation[];
  nextCursor: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  position: number;
  createdAt: string;
}

export interface ChatSearchResult {
  conversationId: string;
  title: string;
  platform: string;
  preview: string;
  score: number;
}

// Per-platform, not one account-wide total — the Core cap is 500 searchable conversations from a
// single platform on a single account, not one pool shared across every connected platform
// (MemoryPlugin_Clone_Spec.md §3.3).
export interface HistoryUsage {
  limit: number | null;
  platforms: { platform: string; count: number }[];
}

// Phase 16 (US-INT-03b): what the MCP consent screen needs to render — which app is asking, for
// what. Deliberately minimal; the OAuth mechanics (PKCE, redirect_uri, state) never surface here.
export interface McpConsentInfo {
  clientName: string;
  scopes: string[];
}

export interface MonthlyInsight {
  month: string;
  summary: string | null;
}

export interface FileRecord {
  id: string;
  bucketId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: ProcessingStatus;
  errorReason: string | null;
  pageCount: number | null;
  createdAt: string;
}

export interface FilePage {
  items: FileRecord[];
  nextCursor: string | null;
}

export interface FileCitation {
  page: number;
  excerpt: string;
}

export interface FileAskResult {
  answer: string;
  citations: FileCitation[];
}

export interface FileSearchResult {
  fileId: string;
  filename: string;
  page: number;
  preview: string;
  score: number;
}

export type AskMode = "memories" | "chat_history" | "files" | "all";
export type CitationSourceType = "memory" | "message" | "file";

export interface AskCitation {
  sourceType: CitationSourceType;
  sourceId: string;
  snippet: string;
  meta: Record<string, unknown>;
}

export interface AskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: AskMode | null;
  citations: AskCitation[] | null;
  position: number;
  createdAt: string;
}

export interface AskConversation {
  id: string;
  bucketId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AskConversationDetail extends AskConversation {
  messages: AskMessage[];
}

export interface AskResult {
  conversationId: string;
  message: { id: string; content: string; citations: AskCitation[] };
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
  sourceMemoryId: string | null;
  sourceMessageId: string | null;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DataExportRequest {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  errorReason: string | null;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface DeletionPreview {
  memories: number;
  buckets: number;
  conversations: number;
  files: number;
  apiKeys: number;
  askThreads: number;
}

export interface BillingSummary {
  paymentsEnabled: boolean;
  plan: "core" | "pro";
  status: string;
  trialEndsAt: string | null;
  history: HistoryUsage;
  usage: UsageSummary | null;
}

export interface UsageSummary {
  period: string;
  memoriesCreated: number;
  askQueries: number;
  syncsCompleted: number;
  tokensSaved: number;
  computedAt: string | null;
}

export const api = {
  register: (email: string, password: string) =>
    apiRequest("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: () => apiRequest("/api/auth/logout", { method: "POST" }),

  me: (): Promise<{ account: Account }> => apiRequest("/api/account/me"),

  updateAutoCapture: (autoCapture: Record<string, boolean>) =>
    apiRequest("/api/account/auto-capture", { method: "PATCH", body: JSON.stringify({ autoCapture }) }),

  updateSmartMemory: (enabled: boolean): Promise<{ smartMemoryEnabled: boolean }> =>
    apiRequest("/api/account/smart-memory", { method: "PATCH", body: JSON.stringify({ enabled }) }),

  sessions: (): Promise<{ sessions: Session[] }> => apiRequest("/api/account/sessions"),

  revokeSession: (id: string) => apiRequest(`/api/account/sessions/${id}`, { method: "DELETE" }),

  apiKeys: (): Promise<{ apiKeys: ApiKey[] }> => apiRequest("/api/keys"),

  createApiKey: (name: string): Promise<{ apiKey: ApiKey & { key: string } }> =>
    apiRequest("/api/keys", { method: "POST", body: JSON.stringify({ name, scopes: [] }) }),

  revokeApiKey: (id: string) => apiRequest(`/api/keys/${id}`, { method: "DELETE" }),

  memories: (params: { cursor?: string; limit?: number; q?: string; bucketId?: string } = {}): Promise<MemoryPage> => {
    const search = new URLSearchParams();
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    if (params.bucketId) search.set("bucketId", params.bucketId);
    const qs = search.toString();
    return apiRequest(`/api/memories${qs ? `?${qs}` : ""}`);
  },

  memory: (id: string): Promise<{ memory: Memory }> => apiRequest(`/api/memories/${id}`),

  createMemory: (content: string, bucketId?: string): Promise<{ memory: Memory }> =>
    apiRequest("/api/memories", { method: "POST", body: JSON.stringify({ content, bucketId }) }),

  createImageMemory: (file: File, caption: string, bucketId?: string): Promise<{ memory: Memory }> => {
    const form = new FormData();
    form.set("image", file);
    if (caption) form.set("caption", caption);
    if (bucketId) form.set("bucketId", bucketId);
    return apiRequest("/api/memories/image", { method: "POST", body: form });
  },

  moveMemory: (id: string, bucketId: string): Promise<{ memory: Memory }> =>
    apiRequest(`/api/memories/${id}/bucket`, { method: "PATCH", body: JSON.stringify({ bucketId }) }),

  updateMemory: (id: string, content: string): Promise<{ memory: Memory }> =>
    apiRequest(`/api/memories/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),

  deleteMemory: (id: string) => apiRequest(`/api/memories/${id}`, { method: "DELETE" }),

  memoryVersions: (id: string): Promise<{ versions: MemoryVersion[] }> => apiRequest(`/api/memories/${id}/versions`),

  suggestions: (): Promise<{ suggestions: Suggestion[] }> => apiRequest("/api/suggestions"),

  approveSuggestion: (id: string): Promise<{ suggestion: Suggestion }> =>
    apiRequest(`/api/suggestions/${id}/approve`, { method: "POST" }),

  dismissSuggestion: (id: string): Promise<{ suggestion: Suggestion }> =>
    apiRequest(`/api/suggestions/${id}/dismiss`, { method: "POST" }),

  // Phase 19 (ADR-0004): the spec's "Check for new" manual scan action — re-runs the curator
  // across every active memory in one bucket.
  scanSuggestions: (bucketId: string): Promise<{ scanned: number }> =>
    apiRequest("/api/suggestions/scan", { method: "POST", body: JSON.stringify({ bucketId }) }),

  capture: (snippet: string): Promise<{ suggestions: Suggestion[] }> =>
    apiRequest("/api/capture", { method: "POST", body: JSON.stringify({ snippet }) }),

  buckets: (): Promise<{ buckets: Bucket[] }> => apiRequest("/api/buckets"),

  createBucket: (name: string, parentId?: string): Promise<{ bucket: Bucket }> =>
    apiRequest("/api/buckets", { method: "POST", body: JSON.stringify({ name, parentId }) }),

  renameBucket: (id: string, name: string): Promise<{ bucket: Bucket }> =>
    apiRequest(`/api/buckets/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  moveBucket: (id: string, parentId: string | null): Promise<{ bucket: Bucket }> =>
    apiRequest(`/api/buckets/${id}`, { method: "PATCH", body: JSON.stringify({ parentId }) }),

  deleteBucket: (id: string) => apiRequest(`/api/buckets/${id}`, { method: "DELETE" }),

  bucketMembers: (id: string): Promise<{ members: BucketMember[] }> => apiRequest(`/api/buckets/${id}/members`),

  inviteToBucket: (id: string, email: string, role: "editor" | "viewer") =>
    apiRequest(`/api/buckets/${id}/invites`, { method: "POST", body: JSON.stringify({ email, role }) }),

  changeMemberRole: (bucketId: string, userId: string, role: "editor" | "viewer") =>
    apiRequest(`/api/buckets/${bucketId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),

  removeMember: (bucketId: string, userId: string) =>
    apiRequest(`/api/buckets/${bucketId}/members/${userId}`, { method: "DELETE" }),

  acceptInvite: (token: string) => apiRequest(`/api/invites/${token}/accept`, { method: "POST" }),

  categories: (): Promise<{ categories: Category[] }> => apiRequest("/api/categories"),

  renameCategory: (id: string, label: string): Promise<{ category: Category }> =>
    apiRequest(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify({ label }) }),

  previewContext: (params: { snippet: string; bucketId?: string }): Promise<ContextPreview> =>
    apiRequest("/api/context/preview", { method: "POST", body: JSON.stringify(params) }),

  importConversations: (file: File, bucketId: string, platform: string): Promise<{ conversationsQueued: number }> => {
    const form = new FormData();
    form.set("file", file);
    form.set("bucketId", bucketId);
    form.set("platform", platform);
    return apiRequest("/api/chat-history/import", { method: "POST", body: form });
  },

  conversations: (params: { bucketId?: string; cursor?: string; limit?: number } = {}): Promise<ConversationPage> => {
    const search = new URLSearchParams();
    if (params.bucketId) search.set("bucketId", params.bucketId);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return apiRequest(`/api/chat-history/conversations${qs ? `?${qs}` : ""}`);
  },

  transcript: (
    id: string,
    params: { cursor?: number; limit?: number } = {},
  ): Promise<{ conversation: Conversation; messages: ChatMessage[]; nextCursor: number | null }> => {
    const search = new URLSearchParams();
    if (params.cursor !== undefined) search.set("cursor", String(params.cursor));
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return apiRequest(`/api/chat-history/conversations/${id}${qs ? `?${qs}` : ""}`);
  },

  chatSearch: (params: { query: string; bucketId?: string; mode?: "semantic" | "precise" }): Promise<{ results: ChatSearchResult[] }> =>
    apiRequest("/api/chat-history/search", { method: "POST", body: JSON.stringify(params) }),

  historyUsage: (): Promise<HistoryUsage> => apiRequest("/api/chat-history/usage"),

  monthlyInsight: (month?: string): Promise<{ insight: MonthlyInsight }> =>
    apiRequest(`/api/chat-history/insights${month ? `?month=${month}` : ""}`),

  mcpConsent: (requestId: string): Promise<McpConsentInfo> => apiRequest(`/api/mcp/consent/${requestId}`),

  approveMcpConsent: (requestId: string): Promise<{ redirectUrl: string }> =>
    apiRequest(`/api/mcp/consent/${requestId}/approve`, { method: "POST" }),

  denyMcpConsent: (requestId: string): Promise<{ redirectUrl: string }> =>
    apiRequest(`/api/mcp/consent/${requestId}/deny`, { method: "POST" }),

  uploadFile: (file: File, bucketId: string): Promise<{ file: FileRecord }> => {
    const form = new FormData();
    form.set("file", file);
    form.set("bucketId", bucketId);
    return apiRequest("/api/files", { method: "POST", body: form });
  },

  files: (params: { bucketId?: string; cursor?: string; limit?: number } = {}): Promise<FilePage> => {
    const search = new URLSearchParams();
    if (params.bucketId) search.set("bucketId", params.bucketId);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return apiRequest(`/api/files${qs ? `?${qs}` : ""}`);
  },

  file: (id: string): Promise<{ file: FileRecord }> => apiRequest(`/api/files/${id}`),

  deleteFile: (id: string) => apiRequest(`/api/files/${id}`, { method: "DELETE" }),

  askFile: (id: string, question: string): Promise<FileAskResult> =>
    apiRequest(`/api/files/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),

  fileSearch: (params: { query: string; bucketId?: string }): Promise<{ results: FileSearchResult[] }> =>
    apiRequest("/api/files/search", { method: "POST", body: JSON.stringify(params) }),

  ask: (params: { conversationId?: string; question: string; mode: AskMode; bucketId?: string }): Promise<AskResult> =>
    apiRequest("/api/ask", { method: "POST", body: JSON.stringify(params) }),

  askThreads: (params: { cursor?: string; limit?: number } = {}): Promise<{ items: AskConversation[]; nextCursor: string | null }> => {
    const search = new URLSearchParams();
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return apiRequest(`/api/ask/threads${qs ? `?${qs}` : ""}`);
  },

  askThread: (id: string): Promise<{ conversation: AskConversationDetail }> => apiRequest(`/api/ask/threads/${id}`),

  claimExtensionPairing: (code: string): Promise<{ apiKeyId: string }> =>
    apiRequest("/api/extension/pairing/claim", { method: "POST", body: JSON.stringify({ code }) }),

  claimDesktopPairing: (input: DesktopPairingClaim): Promise<{ apiKeyId: string; deviceId: string }> =>
    apiRequest("/api/desktop/pairing/claim", { method: "POST", body: JSON.stringify(input) }),

  desktopDevices: (): Promise<{ devices: DesktopDevice[] }> => apiRequest("/api/desktop/devices"),

  revokeDesktopDevice: (id: string): Promise<{ device: DesktopDevice }> =>
    apiRequest(`/api/desktop/devices/${id}`, { method: "DELETE" }),

  knowledgeGraph: (params: { bucketId?: string } = {}): Promise<KnowledgeGraph> => {
    const search = new URLSearchParams();
    if (params.bucketId) search.set("bucketId", params.bucketId);
    const qs = search.toString();
    return apiRequest(`/api/intelligence/graph${qs ? `?${qs}` : ""}`);
  },

  usageSummary: (period?: string): Promise<{ usage: UsageSummary }> =>
    apiRequest(`/api/intelligence/usage${period ? `?period=${period}` : ""}`),

  intelligenceInsight: (month?: string): Promise<{ insight: MonthlyInsight }> =>
    apiRequest(`/api/intelligence/insights${month ? `?month=${month}` : ""}`),

  billingSummary: (): Promise<BillingSummary> => apiRequest("/api/billing/summary"),

  createCheckoutSession: (plan: "pro"): Promise<{ url: string }> =>
    apiRequest("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) }),

  createBillingPortalSession: (): Promise<{ url: string }> =>
    apiRequest("/api/billing/portal", { method: "POST" }),

  markTourSeen: (): Promise<{ hasSeenTour: boolean }> =>
    apiRequest("/api/account/tour-seen", { method: "POST" }),

  revokeOtherSessions: (): Promise<{ revokedCount: number }> =>
    apiRequest("/api/account/sessions/revoke-others", { method: "POST" }),

  requestExport: (): Promise<{ export: DataExportRequest }> =>
    apiRequest("/api/account/export", { method: "POST" }),

  exports: (): Promise<{ exports: DataExportRequest[] }> => apiRequest("/api/account/export"),

  deletionPreview: (): Promise<{ preview: DeletionPreview }> => apiRequest("/api/account/deletion-preview"),

  deleteAccount: (confirmation: string) =>
    apiRequest("/api/account", { method: "DELETE", body: JSON.stringify({ confirmation }) }),
};

/**
 * The export archive is a file download rather than a JSON payload. It's fetched with the normal
 * Authorization header and turned into a blob URL client-side, deliberately *not* linked to
 * directly with a token in the query string — a URL-borne credential ends up in server access
 * logs, browser history, and referrer headers, which is precisely the wrong place for a key that
 * unlocks a complete copy of someone's data.
 */
export async function downloadExportArchive(id: string): Promise<void> {
  const blob = await apiRequestBlob(`/api/account/export/${id}/download`);
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `memoryos-export-${id}.json`;
  // Appended to the document because a detached anchor is ignored by some browsers.
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoked on a later tick, not synchronously after click(): the browser starts fetching the
  // blob asynchronously, and revoking it in the same tick cancels the download before it begins.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function memoryImageSrc(memory: Memory): string | null {
  if (!memory.imageUrl) return null;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${memory.imageUrl}`;
}
