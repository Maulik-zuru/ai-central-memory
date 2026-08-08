import { apiRequest } from "./api-client";

export interface Account {
  id: string;
  email: string;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
  autoCapture: Record<string, boolean>;
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

export interface Memory {
  id: string;
  bucketId: string;
  type: "text" | "image";
  content: string;
  imageUrl: string | null;
  source: "manual" | "one_click" | "auto";
  status: "active" | "stale" | "merged" | "deleted";
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

export interface Suggestion {
  id: string;
  type: "duplicate" | "stale" | "capture";
  memoryIdA: string | null;
  memoryIdB: string | null;
  draftContent: string | null;
  status: "pending" | "approved" | "dismissed";
  createdAt: string;
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

  sessions: (): Promise<{ sessions: Session[] }> => apiRequest("/api/account/sessions"),

  revokeSession: (id: string) => apiRequest(`/api/account/sessions/${id}`, { method: "DELETE" }),

  apiKeys: (): Promise<{ apiKeys: ApiKey[] }> => apiRequest("/api/keys"),

  createApiKey: (name: string): Promise<{ apiKey: ApiKey & { key: string } }> =>
    apiRequest("/api/keys", { method: "POST", body: JSON.stringify({ name, scopes: [] }) }),

  revokeApiKey: (id: string) => apiRequest(`/api/keys/${id}`, { method: "DELETE" }),

  memories: (params: { cursor?: string; limit?: number; q?: string } = {}): Promise<MemoryPage> => {
    const search = new URLSearchParams();
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.q) search.set("q", params.q);
    const qs = search.toString();
    return apiRequest(`/api/memories${qs ? `?${qs}` : ""}`);
  },

  memory: (id: string): Promise<{ memory: Memory }> => apiRequest(`/api/memories/${id}`),

  createMemory: (content: string): Promise<{ memory: Memory }> =>
    apiRequest("/api/memories", { method: "POST", body: JSON.stringify({ content }) }),

  createImageMemory: (file: File, caption: string): Promise<{ memory: Memory }> => {
    const form = new FormData();
    form.set("image", file);
    if (caption) form.set("caption", caption);
    return apiRequest("/api/memories/image", { method: "POST", body: form });
  },

  updateMemory: (id: string, content: string): Promise<{ memory: Memory }> =>
    apiRequest(`/api/memories/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),

  deleteMemory: (id: string) => apiRequest(`/api/memories/${id}`, { method: "DELETE" }),

  memoryVersions: (id: string): Promise<{ versions: MemoryVersion[] }> => apiRequest(`/api/memories/${id}/versions`),

  suggestions: (): Promise<{ suggestions: Suggestion[] }> => apiRequest("/api/suggestions"),

  approveSuggestion: (id: string): Promise<{ suggestion: Suggestion }> =>
    apiRequest(`/api/suggestions/${id}/approve`, { method: "POST" }),

  dismissSuggestion: (id: string): Promise<{ suggestion: Suggestion }> =>
    apiRequest(`/api/suggestions/${id}/dismiss`, { method: "POST" }),

  capture: (snippet: string): Promise<{ suggestions: Suggestion[] }> =>
    apiRequest("/api/capture", { method: "POST", body: JSON.stringify({ snippet }) }),
};

export function memoryImageSrc(memory: Memory): string | null {
  if (!memory.imageUrl) return null;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${memory.imageUrl}`;
}
