import type { SiteAdapter } from "./types";
import { chatGptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { geminiAdapter } from "./gemini";

const ADAPTERS: SiteAdapter[] = [chatGptAdapter, claudeAdapter, geminiAdapter];

export function getActiveAdapter(url: string): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.matches(url));
}

export type { SiteAdapter };
