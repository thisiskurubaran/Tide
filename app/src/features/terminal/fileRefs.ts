// File references in program output: Node and Python stack traces, and the
// file:line:col / file(line,col) forms tsc, eslint, pytest and friends print.
// Shared by the terminal page (to underline them) and the app (to open them).

export interface FileRef {
  // Offsets in the line of text, end exclusive.
  start: number;
  end: number;
  path: string;
  line: number;
  column?: number;
}

const EXT = '[A-Za-z][A-Za-z0-9]{0,9}';
const PATH = `[\\w@~.+-]*(?:/[\\w@~.+ -]*[\\w@~.+-])*\\.${EXT}`;
const PATTERNS: RegExp[] = [
  // Python: File "/x/projects/demo/main.py", line 3
  /File "([^"]+)", line (\d+)/g,
  // tsc: src/a.ts(12,5)
  new RegExp(`(${PATH})\\((\\d+),(\\d+)\\)`, 'g'),
  // Everything else: path:line[:col], possibly inside (…) in a Node stack.
  new RegExp(`(${PATH}):(\\d+)(?::(\\d+))?`, 'g'),
];

export function findFileRefs(text: string): FileRef[] {
  const refs: FileRef[] = [];
  // URLs are the web-links addon's job.
  const urls = [...text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi)].map((u) => [u.index!, u.index! + u[0].length]);
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const path = m[1].trim();
      const start = m.index + m[0].indexOf(m[1]);
      const end = m.index + m[0].length;
      if (urls.some(([a, b]) => start < b && end > a)) continue;
      // node:internal/… frames aren't files.
      if (/\bnode:$/.test(text.slice(0, start))) continue;
      if (/^\d+(\.\d+)+$/.test(path)) continue;
      if (refs.some((r) => start < r.end && end > r.start)) continue;
      refs.push({ start, end, path, line: Number(m[2]), ...(m[3] ? { column: Number(m[3]) } : {}) });
    }
  }
  return refs.sort((a, b) => a.start - b.start);
}

// The project file a reference points at: device paths are cut down to the
// part inside the project, and anything else is matched by its ending against
// the project's files (tools print paths relative to where they ran).
export function projectFileFor(raw: string, project: string, files: string[]): string | null {
  let path = raw.replace(/\\/g, '/');
  const marker = `/projects/${project}/`;
  const at = path.indexOf(marker);
  if (at >= 0) path = path.slice(at + marker.length);
  path = path.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (files.includes(path)) return path;
  const parts = path.split('/').filter((p) => p && p !== '..' && p !== '.');
  // Longest matching ending wins; ties go to the shortest path.
  for (let n = parts.length; n >= 1; n--) {
    const tail = parts.slice(parts.length - n).join('/');
    const hits = files.filter((f) => f === tail || f.endsWith(`/${tail}`));
    if (hits.length) return hits.sort((a, b) => a.length - b.length)[0];
  }
  return null;
}
