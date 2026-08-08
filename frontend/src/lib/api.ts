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
};
