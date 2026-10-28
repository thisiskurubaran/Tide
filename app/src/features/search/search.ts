// What search needs from the workspace.
export interface SearchFiles {
  listFiles(project: string): Promise<string[]>;
  readFile(project: string, path: string): Promise<string>;
}

export interface SearchMatch {
  line: number; // 1-based
  // 0-based, into `text`, which may be a trimmed excerpt of the line.
  column: number;
  text: string;
}

export interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: FileMatches[];
  total: number;
  // True when the match limit cut the results short.
  truncated: boolean;
}

const MAX_MATCHES = 500;
const MAX_FILE_CHARS = 1_000_000;
const MAX_LINE_CHARS = 200;

// Leading indentation is dropped, and long lines (minified files) are cut
// around the match, so the list stays readable.
function excerpt(line: string, column: number): { text: string; column: number } {
  const indent = line.length - line.trimStart().length;
  let start = Math.min(indent, column);
  let prefix = '';
  if (line.length - start > MAX_LINE_CHARS && column - start > 40) {
    start = column - 40;
    prefix = '...';
  }
  return { text: prefix + line.slice(start, start + MAX_LINE_CHARS), column: prefix.length + column - start };
}

export async function searchProject(
  files: SearchFiles,
  project: string,
  query: string,
  { caseSensitive = false }: { caseSensitive?: boolean } = {},
): Promise<SearchResult> {
  const result: SearchResult = { files: [], total: 0, truncated: false };
  if (!query) return result;
  const needle = caseSensitive ? query : query.toLowerCase();
  const paths = (await files.listFiles(project)).sort();
  for (const path of paths) {
    const content = await files.readFile(project, path).catch(() => null);
    // Skip unreadable, huge and binary files.
    if (content === null || content.length > MAX_FILE_CHARS || content.includes('\u0000')) continue;
    const matches: SearchMatch[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const column = (caseSensitive ? line : line.toLowerCase()).indexOf(needle);
      if (column === -1) continue;
      matches.push({ line: i + 1, ...excerpt(line.replace(/\r$/, ''), column) });
      if (++result.total >= MAX_MATCHES) break;
    }
    if (matches.length) result.files.push({ path, matches });
    if (result.total >= MAX_MATCHES) {
      result.truncated = true;
      break;
    }
  }
  return result;
}
