// Deliberately duplicated from frontend/src/lib/api.ts rather than shared via a workspace package
// — this repo has never adopted npm workspaces (see docs/Phase8_BrowserExtension_Implementation_Plan.md
// §4), and only these few shapes are actually shared between the dashboard and the extension.

export interface Account {
  id: string;
  email: string;
  autoCapture: Record<string, boolean>;
  smartMemoryEnabled: boolean;
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
  // "stale" is the pre-Phase-18 generic type, still handled for any suggestion created before
  // ADR-0003's replaces/extends classification landed — new detections are always one of those two.
  type: "duplicate" | "stale" | "replaces" | "extends" | "capture";
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

export interface PairingStartResult {
  code: string;
  expiresAt: string;
}

export type PairingStatus =
  | { status: "pending" }
  | { status: "claimed"; key: string }
  | { status: "expired" };
