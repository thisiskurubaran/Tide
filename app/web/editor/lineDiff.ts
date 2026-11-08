// The edits that turn one text into another, for text changed outside the
// editor (format on save, a formatter, git). When the line count is the same
// (or one line was added or removed at the end, as a final newline does),
// each changed line gets its own small change, so a cursor elsewhere doesn't
// move and one on a trimmed line only moves back to the new line end.
// Otherwise it is one change around everything that differs.
import { minimalChange } from './features';

export type TextChange = { from: number; to: number; insert: string };

export function lineChanges(from: string, to: string): TextChange[] {
  if (from === to) return [];
  const a = from.split('\n');
  const b = to.split('\n');
  if (Math.abs(a.length - b.length) > 1) {
    const one = minimalChange(from, to);
    return one ? [one] : [];
  }
  const changes: TextChange[] = [];
  const n = Math.min(a.length, b.length);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const line = a[i];
    if (line !== b[i]) {
      const c = minimalChange(line, b[i])!;
      changes.push({ from: pos + c.from, to: pos + c.to, insert: c.insert });
    }
    pos += line.length + 1;
  }
  // One line more or fewer, at the end.
  if (b.length > a.length) changes.push({ from: from.length, to: from.length, insert: `\n${b[n]}` });
  else if (a.length > b.length) changes.push({ from: from.length - a[n].length - 1, to: from.length, insert: '' });
  // Too many scattered edits (a reformat that shifted lines) read better as one.
  if (changes.length > 200) {
    const one = minimalChange(from, to);
    return one ? [one] : [];
  }
  return changes;
}
