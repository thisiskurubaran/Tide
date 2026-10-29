// Git conflict markers in plain text, for the merge editor:
//
//   <<<<<<< HEAD
//   ours
//   ||||||| base        (diff3 style only)
//   base
//   =======
//   theirs
//   >>>>>>> branch
export interface ConflictSides {
  ours: string;
  theirs: string;
  count: number;
  // The labels after <<<<<<< and >>>>>>>, e.g. "HEAD" and "feature".
  oursLabel: string;
  theirsLabel: string;
}

// The whole file resolved one way, and the other: everything outside the
// conflicts is shared.
export function splitConflicts(text: string): ConflictSides | null {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const ours: string[] = [];
  const theirs: string[] = [];
  let state: 'out' | 'ours' | 'base' | 'theirs' = 'out';
  let count = 0;
  let oursLabel = '';
  let theirsLabel = '';
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '');
    if (state === 'out' && bare.startsWith('<<<<<<<')) {
      state = 'ours';
      oursLabel ||= bare.slice(7).trim();
    } else if (state === 'ours' && bare.startsWith('|||||||')) state = 'base';
    else if ((state === 'ours' || state === 'base') && bare.startsWith('=======')) state = 'theirs';
    else if (state === 'theirs' && bare.startsWith('>>>>>>>')) {
      state = 'out';
      count++;
      theirsLabel ||= bare.slice(7).trim();
    } else if (state === 'out') {
      ours.push(line);
      theirs.push(line);
    } else if (state === 'ours') ours.push(line);
    else if (state === 'theirs') theirs.push(line);
  }
  // An unfinished conflict means the markers aren't what we think they are.
  if (count === 0 || state !== 'out') return null;
  return { ours: ours.join(''), theirs: theirs.join(''), count, oursLabel, theirsLabel };
}

export const hasConflicts = (text: string) => splitConflicts(text) !== null;
