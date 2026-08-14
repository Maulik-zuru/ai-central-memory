// Deliberately duplicated from frontend/src/lib/api.ts rather than shared via a workspace package
// — this repo has never adopted npm workspaces (see docs/Phase8_BrowserExtension_Implementation_Plan.md
// §4), and only these few shapes are actually shared between the dashboard and the extension.

export interface Account {
  id: string;
  email: string;
  autoCapture: Record<string, boolean>;
  smartMemoryEnabled: boolean;
  // Phase 22: the Account tab's plan badge — null on a free deployment with payments off
  // (account.service.ts always reports 'pro' there, never actually null).
  subscription: { plan: string } | null;
}

export interface Memory {
  id: string;
  bucketId: string;
  content: string;
  source: "manual" | "one_click" | "auto";
  createdAt: string;
}

export type BucketRole = "owner" | "editor" | "viewer";

export interface Bucket {
  id: string;
  name: string;
  isDefault: boolean;
  parentId: string | null;
  role: BucketRole;
}

export interface Suggestion {
  id: string;
  // Phase 19 (ADR-0004 "Memory Suggestions curator"): the curator's three operation types, plus
  // "capture" (a draft awaiting confirmation, unrelated to the curator).
  type: "remove" | "combine" | "update" | "capture";
  draftContent: string | null;
  status: "pending" | "approved" | "dismissed";
}

export interface ContextMemory {
  id: string;
  content: string;
  score: number;
}

export interface ContextPreview {
  smartModeEnabled: boolean;
  memories: ContextMemory[];
  actualTokens: number;
  everythingTokens: number;
  tokenBudget: number;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  revoked: boolean;
}

// Phase 22: only what the popup's History tab actually renders — the full Conversation shape
// (excludedAt/pinned/etc., Phase 21) lives dashboard-side, not duplicated here.
export interface ConversationSummary {
  id: string;
  platform: string;
  title: string;
  status: string;
  importedAt: string;
}

export interface PairingStartResult {
  code: string;
  expiresAt: string;
}

export type PairingStatus =
  | { status: "pending" }
  | { status: "claimed"; key: string }
  | { status: "expired" };
