// .editorconfig support (https://spec.editorconfig.org): a pure parser, the
// glob matcher and the resolution of the properties that apply to one file.
// No React Native imports, so it is easy to test; loading the files from the
// project is done by the caller through `read`.

export interface EditorConfigSection {
  glob: string;
  // Keys lowercased; values as written (trimmed).
  props: Record<string, string>;
}

export interface EditorConfigFile {
  root: boolean;
  sections: EditorConfigSection[];
}

// What Tide applies from the resolved properties. Missing means "not set by
// .editorconfig": the app's own setting applies.
export interface FileFormatting {
  indent?: { unit: 'tab' | 'space'; size: number; tabWidth: number };
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
}

export function parseEditorConfig(text: string): EditorConfigFile {
  const out: EditorConfigFile = { root: false, sections: [] };
  let section: EditorConfigSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Only whole-line comments: the spec (0.15) dropped inline ones, so
    // `charset = utf-8 # x` would be a value with a # in it.
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = { glob: line.slice(1, -1), props: {} };
      out.sections.push(section);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (section) section.props[key] = value;
    else if (key === 'root') out.root = value.toLowerCase() === 'true';
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.+^$()|\\/]/g, '\\$&');

// Finds the `}` that closes the `{` at `open`, or -1.
function closingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    const c = glob[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// Splits "a,b{c,d},e" on top-level commas.
function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

// The regular expression source for an EditorConfig glob: `*` (not across
// /), `**` (across /), `?`, `[abc]`, `[!abc]`, `{a,b}` and `{1..10}`.
function globSource(glob: string): string {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '\\' && i + 1 < glob.length) {
      re += escapeRe(glob[++i]).replace(/[*?[\]{}]/, '\\$&');
    } else if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" also matches no folder at all: a/**/b matches a/b.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i++;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else {
        let cls = glob.slice(i + 1, end);
        const negate = cls.startsWith('!') || cls.startsWith('^');
        if (negate) cls = cls.slice(1);
        re += `[${negate ? '^' : ''}${cls.replace(/\\/g, '\\\\').replace(/\//g, '')}]`;
        i = end;
      }
    } else if (c === '{') {
      const end = closingBrace(glob, i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      const body = glob.slice(i + 1, end);
      const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body);
      if (range) {
        // Numbers are checked after the match; here any integer.
        re += '(-?\\d+)';
        rangeChecks.push([Number(range[1]), Number(range[2])]);
      } else {
        const alts = splitAlternatives(body);
        // A single alternative is literal: {a} matches "{a}".
        re += alts.length > 1 ? `(?:${alts.map(globSource).join('|')})` : `\\{${globSource(body)}\\}`;
      }
      i = end;
    } else re += escapeRe(c);
  }
  return re;
}

// Numeric {1..3} ranges in the glob being compiled, in order of their groups.
let rangeChecks: [number, number][] = [];

export interface CompiledGlob {
  test(path: string): boolean;
}

// `path` is relative to the folder of the .editorconfig, without a leading /.
export function compileGlob(pattern: string): CompiledGlob {
  rangeChecks = [];
  let glob = pattern;
  // Without a /, the glob matches the file name in any folder below.
  if (!glob.includes('/')) glob = `**/${glob}`;
  else if (glob.startsWith('/')) glob = glob.slice(1);
  const source = globSource(glob);
  const ranges = rangeChecks;
  rangeChecks = [];
  let re: RegExp;
  try {
    re = new RegExp(`^${source}$`);
  } catch {
    return { test: () => false };
  }
  return {
    test(path) {
      const m = re.exec(path);
      if (!m) return false;
      if (!ranges.length) return true;
      // Range groups are the only capturing groups, in the same order. One
      // in an alternative that didn't match is undefined and doesn't count.
      return ranges.every(([a, b], k) => {
        const g = m[k + 1];
        if (g === undefined) return true;
        const n = Number(g);
        return n >= Math.min(a, b) && n <= Math.max(a, b);
      });
    },
  };
}

export const globMatches = (pattern: string, path: string) => compileGlob(pattern).test(path);

// The properties for `path` from the .editorconfig files that apply to it,
// `files` ordered nearest folder first (as found walking up, ending at the
// one with root = true). `dir` is each file's folder, relative to the project
// root ('' for the root). Nearer files and later sections win.
export function resolveProperties(files: { dir: string; config: EditorConfigFile }[], path: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const { dir, config } of [...files].reverse()) {
    if (dir && !path.startsWith(`${dir}/`)) continue;
    const rel = dir ? path.slice(dir.length + 1) : path;
    for (const section of config.sections) {
      if (!compileGlob(section.glob).test(rel)) continue;
      for (const [k, v] of Object.entries(section.props)) props[k] = v;
    }
  }
  // "unset" removes a property set by a less specific section or file.
  for (const [k, v] of Object.entries(props)) if (v.toLowerCase() === 'unset') delete props[k];
  return props;
}

const positiveInt = (v: string | undefined) => {
  if (v === undefined || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 && n <= 16 ? n : undefined;
};

const bool = (v: string | undefined) => {
  const s = v?.toLowerCase();
  return s === 'true' ? true : s === 'false' ? false : undefined;
};

export function toFileFormatting(props: Record<string, string>): FileFormatting {
  const out: FileFormatting = {};
  const style = props.indent_style?.toLowerCase();
  const sizeRaw = props.indent_size?.toLowerCase();
  const tabWidth = positiveInt(props.tab_width);
  let size = sizeRaw === 'tab' ? tabWidth : positiveInt(sizeRaw);
  // indent_size = tab without tab_width, or a tab style without sizes: the usual 4.
  const width = tabWidth ?? size ?? (style === 'tab' ? 4 : undefined);
  if (size === undefined && (style === 'tab' || sizeRaw === 'tab')) size = width;
  if (style === 'tab' || style === 'space' || size !== undefined) {
    const unit = style === 'tab' ? 'tab' : style === 'space' ? 'space' : sizeRaw === 'tab' ? 'tab' : 'space';
    const s = size ?? width ?? 2;
    out.indent = { unit, size: s, tabWidth: width ?? s };
  }
  const trim = bool(props.trim_trailing_whitespace);
  if (trim !== undefined) out.trimTrailingWhitespace = trim;
  const finalNewline = bool(props.insert_final_newline);
  if (finalNewline !== undefined) out.insertFinalNewline = finalNewline;
  return out;
}

const dirOf = (path: string) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

// Reads the .editorconfig files from the file's folder up to the project
// root, stopping at one with root = true, and resolves them for `path`
// (project-relative). `read` returns null for a missing file.
export async function loadFileFormatting(read: (path: string) => Promise<string | null>, path: string): Promise<FileFormatting> {
  const files: { dir: string; config: EditorConfigFile }[] = [];
  let dir = dirOf(path);
  for (;;) {
    const text = await read(dir ? `${dir}/.editorconfig` : '.editorconfig').catch(() => null);
    if (text !== null) {
      const config = parseEditorConfig(text);
      files.push({ dir, config });
      if (config.root) break;
    }
    if (!dir) break;
    dir = dirOf(dir);
  }
  return files.length ? toFileFormatting(resolveProperties(files, path)) : {};
}
