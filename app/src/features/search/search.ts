// What search needs from the workspace.
export interface SearchFiles {
  listFiles(project: string): Promise<string[]>;
  readFile(project: string, path: string): Promise<string>;
}

export interface SearchMatch {
  line: number; // 1-based
  // 0-based, into `text`, which may be a trimmed excerpt of the line.
  column: number;
  // Length of the match in `text`; regular expressions match varying lengths.
  length: number;
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

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  // Comma-separated globs, e.g. "src/**, *.ts". A pattern without a slash
  // matches the file name in any folder.
  include?: string;
  exclude?: string;
  // Stop after this many matches (default 500); the palette only shows a few.
  limit?: number;
}

const MAX_MATCHES = 500;
const MAX_FILE_CHARS = 1_000_000;
const MAX_LINE_CHARS = 200;

export class SearchError extends Error {}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One regular expression for every mode, so search and replace agree on what matches.
export function buildMatcher(query: string, { caseSensitive = false, wholeWord = false, regex = false }: SearchOptions = {}): RegExp {
  let source = regex ? query : escapeRegex(query);
  if (wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, caseSensitive ? 'gu' : 'giu');
  } catch (e) {
    throw new SearchError(e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Invalid regular expression');
  }
}

function globToRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // "**/" matches any number of folders, including none.
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += escapeRegex(c);
  }
  return new RegExp(`^${out}$`);
}

export function pathFilter(include = '', exclude = ''): (path: string) => boolean {
  const compile = (list: string) =>
    list
      .split(',')
      .map((p) => p.trim().replace(/^\.?\//, ''))
      .filter(Boolean)
      .map((p) => {
        const re = globToRegex(p.endsWith('/') ? `${p}**` : p);
        // No slash: match the name anywhere, like "*.ts". A plain folder name matches everything in it.
        if (!p.includes('/')) return (path: string) => re.test(path.split('/').pop()!) || path.split('/').slice(0, -1).some((d) => re.test(d));
        return (path: string) => re.test(path);
      });
  const inc = compile(include);
  const exc = compile(exclude);
  return (path) => (inc.length === 0 || inc.some((t) => t(path))) && !exc.some((t) => t(path));
}

// Leading indentation is dropped, and long lines (minified files) are cut
// around the match, so the list stays readable.
function excerpt(line: string, column: number, length: number): { text: string; column: number; length: number } {
  const indent = line.length - line.trimStart().length;
  let start = Math.min(indent, column);
  let prefix = '';
  if (line.length - start > MAX_LINE_CHARS && column - start > 40) {
    start = column - 40;
    prefix = '...';
  }
  const text = prefix + line.slice(start, start + MAX_LINE_CHARS);
  const col = prefix.length + column - start;
  return { text, column: col, length: Math.min(length, text.length - col) };
}

const searchable = (content: string | null): content is string => content !== null && content.length <= MAX_FILE_CHARS && !content.includes('\u0000');

export async function searchProject(files: SearchFiles, project: string, query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const result: SearchResult = { files: [], total: 0, truncated: false };
  if (!query) return result;
  const max = options.limit ?? MAX_MATCHES;
  const matcher = buildMatcher(query, options);
  const wanted = pathFilter(options.include, options.exclude);
  const paths = (await files.listFiles(project)).filter(wanted).sort();
  for (const path of paths) {
    const content = await files.readFile(project, path).catch(() => null);
    // Skip unreadable, huge and binary files.
    if (!searchable(content)) continue;
    const matches: SearchMatch[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && result.total < max; i++) {
      const line = lines[i].replace(/\r$/, '');
      matcher.lastIndex = 0;
      const m = matcher.exec(line);
      // Empty matches (e.g. "^" or "a*") would list every line; they aren't useful hits.
      if (!m || m[0].length === 0) continue;
      matches.push({ line: i + 1, ...excerpt(line, m.index, m[0].length) });
      result.total++;
    }
    if (matches.length) result.files.push({ path, matches });
    if (result.total >= max) {
      result.truncated = true;
      break;
    }
  }
  return result;
}

export interface FileReplacement {
  path: string;
  before: string;
  after: string;
  count: number;
}

// $$, $&, $1..$99 and $<name>, as String.replace expands them, from one match's groups.
function expand(replacement: string, match: string, groups: (string | undefined)[], named: Record<string, string> | undefined): string {
  return replacement.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, (whole, token: string, name?: string) => {
    if (token === '$') return '$';
    if (token === '&') return match;
    if (name !== undefined) return named?.[name] ?? '';
    const n = Number(token);
    // "$12" with only one group means group 1 then "2".
    if (n >= 1 && n <= groups.length) return groups[n - 1] ?? '';
    if (token.length === 2 && Number(token[0]) >= 1 && Number(token[0]) <= groups.length) return (groups[Number(token[0]) - 1] ?? '') + token[1];
    return whole;
  });
}

// In regex mode the replacement can use $1, $<name> and $&; otherwise it is literal.
export function replaceInText(content: string, matcher: RegExp, replacement: string, regex: boolean): { text: string; count: number } {
  let count = 0;
  const text = content.replace(matcher, (...args: unknown[]) => {
    const match = args[0] as string;
    if (match === '') return '';
    count++;
    if (!regex) return replacement;
    const hasNamed = typeof args[args.length - 1] === 'object';
    const named = hasNamed ? (args[args.length - 1] as Record<string, string>) : undefined;
    // (match, ...groups, offset, input[, named])
    const groups = args.slice(1, args.length - (hasNamed ? 3 : 2)) as (string | undefined)[];
    return expand(replacement, match, groups, named);
  });
  return { text, count };
}

// Works out every change "Replace all" would make, without writing anything.
export async function planReplace(
  files: SearchFiles,
  project: string,
  query: string,
  replacement: string,
  options: SearchOptions = {},
  only?: string[],
): Promise<FileReplacement[]> {
  if (!query) return [];
  const matcher = buildMatcher(query, options);
  const wanted = pathFilter(options.include, options.exclude);
  const paths = (only ?? (await files.listFiles(project)).filter(wanted)).sort();
  const out: FileReplacement[] = [];
  for (const path of paths) {
    const before = await files.readFile(project, path).catch(() => null);
    if (!searchable(before)) continue;
    const { text, count } = replaceInText(before, matcher, replacement, !!options.regex);
    if (count > 0 && text !== before) out.push({ path, before, after: text, count });
  }
  return out;
}
