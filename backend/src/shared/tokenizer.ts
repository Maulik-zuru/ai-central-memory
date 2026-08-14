import { countTokens, encode, decode } from 'gpt-tokenizer';

// A real tokenizer, not a character-count guess — the whole point of the "savings figure is
// accurate to what was actually sent" claim in US-ADV-01 (Phase4_Implementation_Plan.md §4).
export function tokenCount(text: string): number {
  return countTokens(text);
}

/**
 * Phase 17 (US-ARC-07): splits `text` into chunks of at most `targetTokens` actual BPE tokens
 * (real token boundaries via encode/decode, not a character-count approximation), with
 * `overlapTokens` of the previous chunk's tail repeated at the start of the next — "light
 * overlap" so a sentence split across a chunk boundary isn't orphaned from its neighbor context.
 * Shared by sync.service.ts (new imports) and the Phase 17 re-chunk migration (existing ones),
 * so both go through the exact same chunking rule rather than two copies that could drift.
 */
export function chunkByTokens(text: string, targetTokens: number, overlapTokens = 0): string[] {
  const tokens = encode(text);
  if (tokens.length <= targetTokens) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < tokens.length) {
    const end = Math.min(start + targetTokens, tokens.length);
    chunks.push(decode(tokens.slice(start, end)));
    if (end >= tokens.length) break;
    start = end - overlapTokens;
  }
  return chunks;
}
