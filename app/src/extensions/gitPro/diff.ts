// Line diffs for Git Pro: Myers' algorithm, grouped into hunks with context,
// and the edits that stage, unstage or discard one hunk.
export type LineOp = { kind: 'same' | 'add' | 'del'; text: string; oldLine?: number; newLine?: number };

export interface Hunk {
  // 1-based starts and line counts, as in a unified diff header.
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: LineOp[];
}

// Over this many lines on both sides combined, files are shown without a diff.
export const MAX_DIFF_LINES = 20_000;

// Lines keep their "\n", so a missing newline at the end of the file is a
// change to the last line, as in git, and joining lines gives the text back.
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

// For display: the line without its newline.
export const lineText = (line: string) => (line.endsWith('\n') ? line.slice(0, -1) : line);

// Shortest edit script between two line arrays (Myers 1986, linear space for the trace per step).
export function diffLines(a: string[], b: string[]): LineOp[] {
  // Common head and tail first: most edits are small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) {
        i++;
        j++;
      }
      v[offset + k] = i;
      if (i >= n && j >= m) {
        trace.push(v.slice());
        break outer;
      }
    }
  }
  // Walk the trace back to recover the edits.
  const middle: LineOp[] = [];
  let i = n;
  let j = m;
  for (let d = trace.length - 2; d >= 0 && (i > 0 || j > 0); d--) {
    const vd = trace[d];
    const k = i - j;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevI = vd[offset + prevK];
    const prevJ = prevI - prevK;
    while (i > prevI && j > prevJ) {
      middle.push({ kind: 'same', text: x[--i] });
      j--;
    }
    if (d === 0) break;
    if (i === prevI) middle.push({ kind: 'add', text: y[--j] });
    else middle.push({ kind: 'del', text: x[--i] });
  }
  while (i > 0 && j > 0) {
    middle.push({ kind: 'same', text: x[--i] });
    j--;
  }
  while (i > 0) middle.push({ kind: 'del', text: x[--i] });
  while (j > 0) middle.push({ kind: 'add', text: y[--j] });
  middle.reverse();

  const ops: LineOp[] = [...a.slice(0, start).map((text) => ({ kind: 'same' as const, text })), ...middle, ...a.slice(endA).map((text) => ({ kind: 'same' as const, text }))];
  // Number the lines on each side.
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    if (op.kind !== 'add') op.oldLine = oldLine++;
    if (op.kind !== 'del') op.newLine = newLine++;
  }
  return ops;
}

export function hunks(ops: LineOp[], context = 3): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === 'same') {
      i++;
      continue;
    }
    // Extend over changes that are within 2 * context lines of each other.
    let end = i;
    let last = i;
    while (end < ops.length) {
      if (ops[end].kind !== 'same') last = end;
      else if (end - last > 2 * context) break;
      end++;
    }
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length, last + context + 1);
    const lines = ops.slice(from, to);
    const first = lines[0];
    const oldStart = first.oldLine ?? (ops.slice(0, from).filter((o) => o.kind !== 'add').length + 1);
    const newStart = first.newLine ?? (ops.slice(0, from).filter((o) => o.kind !== 'del').length + 1);
    const oldLines = lines.filter((l) => l.kind !== 'add').length;
    const newLines = lines.filter((l) => l.kind !== 'del').length;
    // An empty side starts at the line before, as git writes it.
    out.push({ oldStart: oldLines ? oldStart : oldStart - 1, oldLines, newStart: newLines ? newStart : newStart - 1, newLines, lines });
    i = to;
  }
  return out;
}

export function diffText(before: string, after: string, context = 3): Hunk[] | null {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length + b.length > MAX_DIFF_LINES) return null;
  return hunks(diffLines(a, b), context);
}

// `before` with one hunk of the before -> after diff applied: staging a hunk
// (before = index, after = working tree).
export function applyHunk(before: string, _after: string, hunk: Hunk): string {
  const lines = splitLines(before);
  const start = hunk.oldLines ? hunk.oldStart - 1 : hunk.oldStart;
  const replacement = hunk.lines.filter((l) => l.kind !== 'del').map((l) => l.text);
  return [...lines.slice(0, start), ...replacement, ...lines.slice(start + hunk.oldLines)].join('');
}

// `after` with one hunk undone: unstaging a hunk (before = HEAD, after =
// index) or discarding one (before = index, after = working tree).
export function revertHunk(_before: string, after: string, hunk: Hunk): string {
  const lines = splitLines(after);
  const start = hunk.newLines ? hunk.newStart - 1 : hunk.newStart;
  const original = hunk.lines.filter((l) => l.kind !== 'add').map((l) => l.text);
  return [...lines.slice(0, start), ...original, ...lines.slice(start + hunk.newLines)].join('');
}
