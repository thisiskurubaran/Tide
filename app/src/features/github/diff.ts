// A pull request file's patch as lines with their numbers, so a line can be
// commented on: added and unchanged lines by their number in the new file
// (side RIGHT), removed lines by their number in the old one (LEFT).
export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx';
  text: string;
  old: number | null;
  new: number | null;
}

export function parsePatch(patch: string | undefined): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      out.push({ kind: 'hunk', text, old: null, new: null });
    } else if (text.startsWith('+')) out.push({ kind: 'add', text: text.slice(1), old: null, new: newLine++ });
    else if (text.startsWith('-')) out.push({ kind: 'del', text: text.slice(1), old: oldLine++, new: null });
    else if (text.startsWith('\\')) continue; // "\ No newline at end of file"
    else out.push({ kind: 'ctx', text: text.slice(1), old: oldLine++, new: newLine++ });
  }
  return out;
}

// Where a comment on this line goes, or null for hunk headers.
export const commentTarget = (l: DiffLine): { line: number; side: 'LEFT' | 'RIGHT' } | null =>
  l.kind === 'hunk' ? null : l.kind === 'del' ? { line: l.old!, side: 'LEFT' } : { line: l.new!, side: 'RIGHT' };
