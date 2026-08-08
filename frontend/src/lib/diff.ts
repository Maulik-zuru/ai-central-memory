// Minimal word-level diff (LCS-based) — no dependency needed for a two-version comparison view.
export type DiffPart = { text: string; type: "equal" | "added" | "removed" };

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  // Standard LCS table — fine at the token counts a memory's content realistically has.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      parts.push({ text: a[i], type: "equal" });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      parts.push({ text: a[i], type: "removed" });
      i++;
    } else {
      parts.push({ text: b[j], type: "added" });
      j++;
    }
  }
  while (i < n) parts.push({ text: a[i++], type: "removed" });
  while (j < m) parts.push({ text: b[j++], type: "added" });

  // Merge adjacent same-type tokens so the rendered spans aren't one-per-word.
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
