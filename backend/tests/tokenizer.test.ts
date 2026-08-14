import { encode, decode } from 'gpt-tokenizer';
import { chunkByTokens, tokenCount } from '../src/shared/tokenizer';

describe('chunkByTokens (Phase 17 US-ARC-07: token-based chunking with light overlap)', () => {
  it('returns the text unchanged as a single chunk when it is already within the target', () => {
    const text = 'A short message.';
    expect(chunkByTokens(text, 256)).toEqual([text]);
  });

  it('splits long text into multiple chunks, none exceeding the target token count', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    expect(tokenCount(text)).toBeGreaterThan(256);

    const chunks = chunkByTokens(text, 256);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(tokenCount(chunk)).toBeLessThanOrEqual(256);
    }
  });

  it('every chunk after the first repeats exactly the requested overlap from the end of the previous one', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkByTokens(text, 256, 32);
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 1; i < chunks.length; i++) {
      const overlapText = decodeTail(chunks[i - 1], 32);
      expect(chunks[i].startsWith(overlapText)).toBe(true);
    }
  });

  it('with zero overlap, reconstructing all chunks in order reproduces the original token count', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkByTokens(text, 256, 0);
    const totalTokens = chunks.reduce((sum, c) => sum + tokenCount(c), 0);
    expect(totalTokens).toBe(tokenCount(text));
  });

  it('never produces an empty chunk list for non-empty input', () => {
    expect(chunkByTokens('x', 256)).toEqual(['x']);
  });
});

// Mirrors chunkByTokens' own encode/decode slicing so the overlap assertion checks the same
// token boundary the implementation actually cuts on, not a naive character-based guess.
function decodeTail(chunk: string, overlapTokens: number): string {
  const tokens = encode(chunk);
  return decode(tokens.slice(Math.max(0, tokens.length - overlapTokens)));
}
