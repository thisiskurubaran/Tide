import { applyHunk, diffLines, diffText, hunks, revertHunk, splitLines } from './diff';

// Deterministic pseudo-random lines from a small alphabet, so there are many repeats.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
const randomLines = (r: () => number, n: number) => Array.from({ length: n }, () => 'abcde'[Math.floor(r() * 5)]);

function lcs(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

describe('diffLines', () => {
  it('produces a minimal edit script that rebuilds both sides', () => {
    const r = rng(7);
    for (let t = 0; t < 300; t++) {
      const a = randomLines(r, Math.floor(r() * 12));
      const b = randomLines(r, Math.floor(r() * 12));
      const ops = diffLines(a, b);
      expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text)).toEqual(a);
      expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text)).toEqual(b);
      expect(ops.filter((o) => o.kind === 'same').length).toBe(lcs(a, b));
    }
  });

  it('numbers lines on each side', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(ops).toEqual([
      { kind: 'same', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'b', oldLine: 2 },
      { kind: 'add', text: 'x', newLine: 2 },
      { kind: 'same', text: 'c', oldLine: 3, newLine: 3 },
    ]);
  });
});

describe('hunks', () => {
  it('groups nearby changes and writes git-style ranges', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const after = [...before];
    after[1] = 'two';
    after[3] = 'four';
    after.splice(15, 1);
    const hs = hunks(diffLines(before, after));
    expect(hs.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [1, 7, 1, 7],
      [13, 7, 13, 6],
    ]);
  });

  it('starts an empty side at the line before', () => {
    const [h] = diffText('', 'a\nb\n')!;
    expect([h.oldStart, h.oldLines, h.newStart, h.newLines]).toEqual([0, 0, 1, 2]);
  });
});

describe('hunk staging', () => {
  it('stages, unstages and discards single hunks', () => {
    const r = rng(42);
    for (let t = 0; t < 200; t++) {
      const a = randomLines(r, 5 + Math.floor(r() * 25));
      const b = [...a];
      // A few scattered edits.
      for (let e = 0; e < 3; e++) {
        const at = Math.floor(r() * (b.length + 1));
        if (r() < 0.5) b.splice(at, 1);
        else b.splice(at, 0, `new${e}`);
      }
      const before = a.join('\n') + '\n';
      const after = b.join('\n') + (r() < 0.8 ? '\n' : '');
      const hs = diffText(before, after, 1)!;
      // Diffs are minimal, so what is left after one hunk can't be bigger than the other hunks' edits.
      const edits = (list: ReturnType<typeof diffText>) => list!.flatMap((h) => h.lines).filter((l) => l.kind !== 'same').length;
      const total = edits(hs);
      for (const h of hs) {
        const own = edits([h]);
        const staged = applyHunk(before, after, h);
        expect(staged).not.toBe(before);
        expect(edits(diffText(staged, after, 1))).toBeLessThanOrEqual(total - own);
        const discarded = revertHunk(before, after, h);
        expect(discarded).not.toBe(after);
        expect(edits(diffText(before, discarded, 1))).toBeLessThanOrEqual(total - own);
      }
      // Staging every hunk, last first so ranges stay valid, gives the working tree.
      let all = before;
      for (const h of [...hs].reverse()) all = applyHunk(all, after, h);
      expect(all).toBe(after);
    }
  });

  it('treats a missing final newline as a change to the last line', () => {
    expect(splitLines('a\nb')).toEqual(['a\n', 'b']);
    const hs = diffText('a\nb\nc\n', 'A\nb\nc')!;
    expect(hs).toHaveLength(1);
    expect(applyHunk('a\nb\nc\n', 'A\nb\nc', hs[0])).toBe('A\nb\nc');
    expect(revertHunk('a\nb\nc\n', 'A\nb\nc', hs[0])).toBe('a\nb\nc\n');
  });

  it('skips huge files', () => {
    const big = 'x\n'.repeat(15_000);
    expect(diffText(big, big + 'y\n')).toBeNull();
  });
});
