import { countTokens } from 'gpt-tokenizer';

// A real tokenizer, not a character-count guess — the whole point of the "savings figure is
// accurate to what was actually sent" claim in US-ADV-01 (Phase4_Implementation_Plan.md §4).
export function tokenCount(text: string): number {
  return countTokens(text);
}
