// Ruff for Python in Format & Lint: its settings from a project's ruff.toml or
// pyproject.toml, and its diagnostics turned into Tide's. Ruff itself runs as
// WebAssembly in a hidden web view (RuffHost); this part is plain logic.
import type { Diagnostic } from '../diagnostics';
import { LintMessage, toDiagnostics } from './lintMessages';
import { parseToml, tomlTable, TomlTable, TomlValue } from './toml';

export const RUFF_SOURCE = 'ruff';

// Ruff's own defaults. The wasm build's empty settings are the playground's,
// which also turn on import sorting (I001), so the rules are always given.
export const DEFAULT_SELECT = ['E4', 'E7', 'E9', 'F'];

// What Workspace takes: the ruff.toml options, as an object.
export interface RuffSettings {
  'line-length'?: number;
  'indent-width'?: number;
  'target-version'?: string;
  lint: { select: string[]; ignore?: string[]; 'extend-select'?: string[] };
  format?: { 'quote-style'?: string; 'indent-style'?: string; 'skip-magic-trailing-comma'?: boolean; 'docstring-code-format'?: boolean };
}

export const defaultRuffSettings = (): RuffSettings => ({ lint: { select: [...DEFAULT_SELECT] } });

// In the order Ruff looks for them in each folder.
export const CONFIG_FILES = ['.ruff.toml', 'ruff.toml', 'pyproject.toml'];

const strings = (v: TomlValue | undefined) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);
const num = (v: TomlValue | undefined) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);
const str = (v: TomlValue | undefined) => (typeof v === 'string' ? v : undefined);
const bool = (v: TomlValue | undefined) => (typeof v === 'boolean' ? v : undefined);

// The options Tide passes on. Others (paths, per-file ignores, plugins' settings)
// are left out: Workspace rejects a whole settings object over one it doesn't know.
function settingsFrom(t: TomlTable): RuffSettings {
  const lint = tomlTable(t.lint) ?? {};
  const fmt = tomlTable(t.format) ?? {};
  const out: RuffSettings = { lint: { select: strings(lint.select) ?? strings(t.select) ?? [...DEFAULT_SELECT] } };
  const ignore = strings(lint.ignore) ?? strings(t.ignore);
  if (ignore) out.lint.ignore = ignore;
  const extend = strings(lint['extend-select']) ?? strings(t['extend-select']);
  if (extend) out.lint['extend-select'] = extend;
  const lineLength = num(t['line-length']);
  if (lineLength) out['line-length'] = lineLength;
  const indentWidth = num(t['indent-width']);
  if (indentWidth) out['indent-width'] = indentWidth;
  const target = str(t['target-version']);
  if (target && /^py3\d+$/.test(target)) out['target-version'] = target;
  const format: NonNullable<RuffSettings['format']> = {};
  const quote = str(fmt['quote-style']);
  if (quote && ['double', 'single', 'preserve'].includes(quote)) format['quote-style'] = quote;
  const indent = str(fmt['indent-style']);
  if (indent && ['space', 'tab'].includes(indent)) format['indent-style'] = indent;
  const magic = bool(fmt['skip-magic-trailing-comma']);
  if (magic !== undefined) format['skip-magic-trailing-comma'] = magic;
  const docstrings = bool(fmt['docstring-code-format']);
  if (docstrings !== undefined) format['docstring-code-format'] = docstrings;
  if (Object.keys(format).length) out.format = format;
  return out;
}

// Settings from one config file's text, or null if it has no Ruff section
// (a pyproject.toml without [tool.ruff]) or can't be read.
export function parseRuffConfig(fileName: string, text: string): RuffSettings | null {
  let doc: TomlTable;
  try {
    doc = parseToml(text);
  } catch {
    return null;
  }
  if (fileName === 'pyproject.toml') {
    const ruff = tomlTable(tomlTable(doc.tool)?.ruff);
    return ruff ? settingsFrom(ruff) : null;
  }
  return settingsFrom(doc);
}

// The nearest config from the file's folder up to the project root, as Ruff
// finds it. read() returns null for a missing file.
export async function findRuffSettings(path: string, read: (path: string) => Promise<string | null>): Promise<RuffSettings> {
  const parts = path.split('/').slice(0, -1);
  for (let n = parts.length; n >= 0; n--) {
    const dir = parts.slice(0, n).join('/');
    for (const name of CONFIG_FILES) {
      const text = await read(dir ? `${dir}/${name}` : name);
      if (text === null) continue;
      const settings = parseRuffConfig(name, text);
      if (settings) return settings;
    }
  }
  return defaultRuffSettings();
}

// What Workspace.check() returns for each problem (rows and columns 1-based).
export interface RuffDiagnostic {
  code: string | null;
  message: string;
  start_location: { row: number; column: number };
  end_location: { row: number; column: number };
}

const isSyntax = (code: string | null) => !code || code === 'invalid-syntax' || code === 'syntax-error';
// Ruff has no severities. Syntax and IO errors and undefined names fail at
// run time, so they're errors, as ESLint's no-undef is; the rest warn.
const isError = (code: string | null) => isSyntax(code) || /^(E9\d\d|F82[123])$/.test(code!);

export function toLintMessages(items: RuffDiagnostic[]): LintMessage[] {
  return items.map((d) => ({
    line: d.start_location.row,
    column: d.start_location.column,
    endLine: d.end_location.row,
    endColumn: d.end_location.column,
    severity: isError(d.code) ? 'error' : 'warning',
    message: isSyntax(d.code) ? `SyntaxError: ${d.message}` : `${d.code} ${d.message}`,
  }));
}

export const ruffDiagnostics = (content: string, items: RuffDiagnostic[]): Diagnostic[] => toDiagnostics(content, toLintMessages(items), RUFF_SOURCE);
