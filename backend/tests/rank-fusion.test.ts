import { reciprocalRankFusion, fuseAcrossVariants } from '../src/modules/chat-history/rank-fusion';

describe('reciprocalRankFusion (MemoryPlugin_Clone_Spec.md §7.3)', () => {
  it('matches a hand-computed RRF score for a known two-list example', () => {
    // k=60. List 1: [A, B, C] (ranks 0,1,2). List 2: [C, A] (ranks 0,1). B absent from list 2.
    // score(A) = 1/(60+0+1) + 1/(60+1+1) = 1/61 + 1/62
    // score(B) = 1/(60+1+1)                = 1/62
    // score(C) = 1/(60+2+1) + 1/(60+0+1)   = 1/63 + 1/61
    // Expected order by descending score: C (1/61+1/63 ≈ 0.03217) > A (1/61+1/62 ≈ 0.03227)... compute precisely below.
    const scoreA = 1 / 61 + 1 / 62;
    const scoreB = 1 / 62;
    const scoreC = 1 / 63 + 1 / 61;
    expect(scoreA).toBeGreaterThan(scoreC);
    expect(scoreC).toBeGreaterThan(scoreB);

    const fused = reciprocalRankFusion([
      ['A', 'B', 'C'],
      ['C', 'A'],
    ]);

    expect(fused).toEqual(['A', 'C', 'B']);
  });

  it('is scale-invariant: rank position is all that matters, never an underlying raw score', () => {
    // Two retrievers that disagree wildly on raw score magnitude (a dense 0-1 cosine vs. an
    // unbounded BM25) still fuse purely by rank, which RRF never sees in the first place — the
    // input is already just ordered ID lists, so there is no raw-score channel to leak through.
    const fusedA = reciprocalRankFusion([['x', 'y', 'z']]);
    const fusedB = reciprocalRankFusion([['x', 'y', 'z']]);
    expect(fusedA).toEqual(fusedB);
    expect(fusedA).toEqual(['x', 'y', 'z']);
  });

  it('a document appearing in every list ranks above one appearing in only one', () => {
    const fused = reciprocalRankFusion([
      ['shared', 'onlyInFirst'],
      ['shared', 'onlyInSecond'],
    ]);
    expect(fused[0]).toBe('shared');
  });

  it('returns an empty list for no input lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('handles empty lists mixed with populated ones', () => {
    expect(reciprocalRankFusion([[], ['only']])).toEqual(['only']);
  });
});

describe('fuseAcrossVariants (best rank across variants, never first-list-wins)', () => {
  it('keeps a document\'s best (lowest) rank across variants, not whichever variant it saw first', () => {
    // "doc" ranks 5th (last) in variant 1 but 0th (best possible) in variant 2. First-list-wins
    // would leave it stuck behind other1..other5 at position 5; best-rank-across-variants must
    // place it ahead of other5 (whose only, and therefore best, rank is 4) instead. (other1's own
    // best rank is also 0, from variant 1 — a genuine tie with "doc", not something this test
    // needs to break a winner from; the unambiguous, tie-free claim is the comparison against
    // other5.)
    const fused = fuseAcrossVariants([
      ['other1', 'other2', 'other3', 'other4', 'other5', 'doc'],
      ['doc', 'onlyInVariant2'],
    ]);
    expect(fused.indexOf('doc')).toBeLessThan(fused.indexOf('other5'));
  });

  it('preserves relative order for documents with distinct best ranks', () => {
    const fused = fuseAcrossVariants([
      ['a', 'b', 'c'],
      ['b', 'c', 'a'],
    ]);
    // a: best rank 0 (variant1). b: best rank 0 (variant2). c: best rank 1 (variant2, better than variant1's 2).
    // a and b tie at best-rank 0 — stable order keeps a (encountered first) before b.
    expect(fused).toEqual(['a', 'b', 'c']);
  });

  it('a document unique to one variant still appears, ranked by that variant\'s position', () => {
    const fused = fuseAcrossVariants([['a'], ['b', 'onlyHere']]);
    expect(fused).toContain('onlyHere');
  });

  it('returns an empty list for no variants', () => {
    expect(fuseAcrossVariants([])).toEqual([]);
  });
});
