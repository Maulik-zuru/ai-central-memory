import type { SiteAdapter } from "./types";
import { chatGptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { geminiAdapter } from "./gemini";
import { grokAdapter, deepseekAdapter } from "./marker-line-adapter";

// Phase 22: Grok/DeepSeek are marker-line-only (docs/MemoryPlugin_Parity_Implementation_Plan.md
// §Phase 22) — no maintained DOM selectors, just the generic factory in marker-line-adapter.ts.
const ADAPTERS: SiteAdapter[] = [chatGptAdapter, claudeAdapter, geminiAdapter, grokAdapter, deepseekAdapter];

export function getActiveAdapter(url: string): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}

export type { SiteAdapter, ConversationTurn } from "./types";
