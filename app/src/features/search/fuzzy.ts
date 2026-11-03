// Subsequence match for quick open: every query character must appear in
// order. Higher scores for matches in the file name, at word starts and in runs.
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const nameStart = t.lastIndexOf('/') + 1;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += 1;
    if (found === prev + 1) score += 3;
    if (found >= nameStart) score += 2;
    const before = found === 0 ? '/' : t[found - 1];
    if ('/._- '.includes(before)) score += 4;
    prev = found;
    ti = found + 1;
  }
  // Prefer shorter targets when scores tie.
  return score - target.length * 0.01;
}

export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string, limit = 50): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, key(item));
    if (score !== null) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

// Where fuzzyScore matched each query character, for highlighting. Same greedy
// walk as fuzzyScore, so the highlighted letters are the ones that scored.
export function fuzzyPositions(query: string, target: string): number[] | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const out: number[] = [];
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    out.push(found);
    ti = found + 1;
  }
  return out;
}
