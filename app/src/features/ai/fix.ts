// "Fix with AI" for problems: gathers the code around a problem (and the
// files it imports), asks the chat model for small exact-text edits, and
// checks every edit against the current text before it is offered.
//
// The reply format is strict so it can be parsed without guessing:
//
//   <explanation>…</explanation>
//   <edit path="src/a.ts"><old>exact text</old><new>replacement</new></edit>
//
// An edit is kept only when its <old> text occurs exactly once in the file,
// so applying it can never touch the wrong place.
import type { Diagnostic } from '../../extensions/diagnostics';
import { findFileRefs, projectFileFor } from '../terminal/fileRefs';
import { AiError, chat as defaultChat } from './client';
import type { ChatRequest, ChatResult, Usage } from './providers/types';

// What the Fix sheet is asked to fix.
export type FixRequest =
  // The problems on one line of a file (1-based).
  | { kind: 'problem'; path: string; line: number }
  // Every error and warning in a file.
  | { kind: 'file'; path: string }
  // A failed run: the terminal output, and the file it points at when known.
  | { kind: 'run'; output: string; path?: string };

// fix: a first attempt; retry: the user rejected the last one; explain: words only.
export type FixMode = 'fix' | 'retry' | 'explain';

export interface FileChange {
  path: string;
  before: string;
  after: string;
}

export interface FixResult {
  explanation: string;
  changes: FileChange[];
  // Edits the reply had that couldn't be used (malformed, or `old` not found exactly once).
  dropped: number;
  usage: Usage;
  // The reply hit the length limit; later edits may be missing.
  truncated: boolean;
}

// ---- Limits ----

// Everything sent about the code, numbered lines included.
export const MAX_CONTEXT_CHARS = 60_000;
// Of that, the file with the problem gets up to this much.
export const MAX_TARGET_CHARS = 40_000;
export const MAX_RELATED_FILES = 3;
// A related file smaller than this after truncation isn't worth sending.
const MIN_RELATED_CHARS = 1_000;
// Lines shown either side of a problem when the file is too big to send whole.
export const WINDOW_LINES = 80;
// Terminal output for a run error.
export const MAX_RUN_OUTPUT_CHARS = 6_000;
// Problems listed in one request.
export const MAX_PROBLEMS = 30;

// ---- Context ----

export interface ContextSource {
  // Every file in the project, relative to its root.
  files: string[];
  // Current text (unsaved edits included), or null when it can't be read.
  read(path: string): Promise<string | null>;
  // The problems Tide knows about in a file.
  problems(path: string): Diagnostic[];
}

export interface ContextFile {
  path: string;
  role: 'target' | 'related';
  // The whole current text, for validating and applying edits.
  content: string;
  // What the model sees: numbered lines, maybe only part of the file.
  shown: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  partial: boolean;
}

export interface FixProblem {
  path: string;
  line: number;
  column: number;
  severity: Diagnostic['severity'];
  message: string;
  source: string;
}

export interface FixContext {
  request: FixRequest;
  // The file the problem is in; null for a run error that names no project file.
  path: string | null;
  // The line in focus (problem line, or where a run error points).
  line: number | null;
  problems: FixProblem[];
  output: string | null;
  files: ContextFile[];
  // Characters of numbered code sent, for tests and the cost estimate.
  chars: number;
}

// "  12 | code": the gutter the model sees. Edits must not include it.
export function numberLines(lines: string[], start: number, width = String(start + lines.length - 1).length): string {
  return lines.map((l, i) => `${String(start + i).padStart(width)} | ${l}`).join('\n');
}

// The lines to show from a file, as close to `budget` characters as fits:
// the whole file when it fits, otherwise windows around `focus` lines.
export function excerpt(content: string, focus: number[], budget: number): { shown: string; startLine: number; endLine: number; partial: boolean } {
  const lines = content.split('\n');
  const width = String(lines.length).length;
  const whole = numberLines(lines, 1, width);
  if (whole.length <= budget)
    return {
      shown: whole,
      startLine: 1,
      endLine: lines.length,
      partial: false,
    };
  const gutter = width + 3;
  const cost = (from: number, to: number) => {
    let n = 0;
    for (let i = from; i <= to; i++) n += lines[i - 1].length + gutter + 1;
    return n;
  };
  const center = focus.length ? Math.min(...focus) : 1;
  const last = focus.length ? Math.max(...focus) : 1;
  let from = Math.max(1, center - WINDOW_LINES);
  let to = Math.min(lines.length, last + WINDOW_LINES);
  // Shrink evenly until it fits, keeping at least the focus lines.
  while (cost(from, to) > budget && (from < center || to > last)) {
    if (from < center) from++;
    if (to > last && cost(from, to) > budget) to--;
  }
  // Still too long (huge lines): cut the text itself.
  let shown = numberLines(lines.slice(from - 1, to), from, width);
  if (shown.length > budget) shown = shown.slice(0, budget);
  return { shown, startLine: from, endLine: to, partial: true };
}

// Import specifiers in a file, for the languages Tide runs.
export function importsOf(path: string, content: string): string[] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const out: string[] = [];
  const add = (re: RegExp, group = 1) => {
    for (const m of content.matchAll(re)) if (m[group]) out.push(m[group]);
  };
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte'].includes(ext)) {
    add(/\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g);
    add(/\bimport\s*['"]([^'"]+)['"]/g);
    add(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  } else if (ext === 'py') {
    for (const m of content.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+\(?([\w ,\t*]+)/gm)) {
      const mod = m[1];
      if (/^\.+$/.test(mod)) for (const name of m[2].split(',')) out.push(mod + name.trim().split(/\s+/)[0]);
      else out.push(mod);
    }
    for (const m of content.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)/gm)) for (const name of m[1].split(',')) out.push(name.trim().split(/\s+/)[0]);
  } else if (['css', 'scss', 'less'].includes(ext)) {
    add(/@(?:import|use|forward)\s+(?:url\()?\s*['"]([^'"]+)['"]/g);
  } else if (['html', 'htm'].includes(ext)) {
    add(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi);
    add(/<link\b[^>]*\bhref\s*=\s*["']([^"']+\.css)["']/gi);
  } else if (ext === 'rb') {
    add(/\brequire_relative\s*\(?\s*['"]([^'"]+)['"]/g);
  } else if (ext === 'lua') {
    add(/\brequire\s*\(?\s*['"]([^'"]+)['"]/g);
  } else if (ext === 'php') {
    add(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g);
  }
  return [...new Set(out.filter((s) => s && s.trim()))];
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// Joins and normalizes; null when it climbs out of the project.
export function joinRelative(dir: string, rel: string): string | null {
  const parts = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const p of rel.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/') || null;
}

const SCRIPT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.d.ts', '.json', '.vue', '.svelte'];

// The project file an import points at, or null for packages and anything not in the project.
export function resolveImport(spec: string, from: string, files: string[]): string | null {
  const set = new Set(files);
  const ext = from.slice(from.lastIndexOf('.') + 1).toLowerCase();
  const dir = dirOf(from);
  const first = (candidates: (string | null)[]) => candidates.find((c): c is string => c !== null && c !== from && set.has(c)) ?? null;

  if (ext === 'py') {
    const dots = /^\.*/.exec(spec)![0].length;
    const mod = spec.slice(dots).replace(/\./g, '/');
    const bases: (string | null)[] = [];
    if (dots) {
      let base: string | null = dir;
      for (let i = 1; i < dots && base !== null; i++) base = base ? (joinRelative(base, '..') ?? '') : null;
      bases.push(base);
    } else bases.push('', dir, 'src');
    const out: (string | null)[] = [];
    for (const b of bases) {
      if (b === null || !mod) continue;
      const p = b ? `${b}/${mod}` : mod;
      out.push(`${p}.py`, `${p}/__init__.py`);
    }
    return first(out);
  }
  if (ext === 'lua') {
    const p = spec.replace(/\./g, '/');
    return first([`${p}.lua`, `${p}/init.lua`, joinRelative(dir, `${p}.lua`)]);
  }

  // Relative paths, root-relative paths and the common "@/" and "~/" aliases for src/.
  let bases: (string | null)[];
  if (spec.startsWith('.')) bases = [joinRelative(dir, spec)];
  else if (spec.startsWith('/')) bases = [joinRelative('', spec)];
  else if (/^[@~]\//.test(spec)) bases = [joinRelative('src', spec.slice(2)), joinRelative('', spec.slice(2))];
  else if (['css', 'scss', 'less', 'html', 'htm', 'php', 'rb'].includes(ext) && !/^[a-z]+:/i.test(spec)) bases = [joinRelative(dir, spec)];
  else return null;

  const out: (string | null)[] = [];
  for (const b of bases) {
    if (!b) continue;
    out.push(b);
    // TypeScript lets "./a.js" mean ./a.ts.
    const stripped = b.replace(/\.(m|c)?js$/, '');
    for (const e of SCRIPT_EXTS) out.push(stripped + e);
    for (const e of SCRIPT_EXTS) out.push(`${b}/index${e}`);
    if (ext === 'scss' || ext === 'less' || ext === 'css') {
      const name = b.slice(b.lastIndexOf('/') + 1);
      const d = dirOf(b);
      for (const e of ['.scss', '.css', '.less']) out.push(`${b}${e}`, `${d ? `${d}/` : ''}_${name}${e}`);
    }
    if (ext === 'rb') out.push(`${b}.rb`);
  }
  return first(out);
}

const toProblem = (path: string, d: Diagnostic): FixProblem => ({
  path,
  line: d.line,
  column: d.column,
  severity: d.severity,
  message: d.message,
  source: d.source,
});

// Where a run error points: the last stack frame or file:line in the output that is a project file.
export function runTarget(output: string, project: string, files: string[]): { path: string; line: number } | null {
  let found: { path: string; line: number } | null = null;
  for (const line of output.split('\n')) {
    for (const ref of findFileRefs(line)) {
      const path = projectFileFor(ref.path, project, files);
      if (path) found = { path, line: ref.line };
    }
  }
  return found;
}

export async function gatherContext(request: FixRequest, source: ContextSource, project = ''): Promise<FixContext> {
  let path: string | null = null;
  let line: number | null = null;
  let output: string | null = null;
  if (request.kind === 'run') {
    output = request.output.slice(-MAX_RUN_OUTPUT_CHARS);
    const target = runTarget(request.output, project, source.files);
    path = request.path ?? target?.path ?? null;
    line = target && target.path === path ? target.line : null;
  } else {
    path = request.path;
    line = request.kind === 'problem' ? request.line : null;
  }

  const all = path ? source.problems(path) : [];
  const relevant =
    request.kind === 'problem'
      ? all.filter((d) => d.line === request.line)
      : request.kind === 'file'
        ? all.filter((d) => d.severity !== 'info')
        : // A run error: what's known about the line it points at (the output itself says the rest).
          all.filter((d) => line !== null && d.line === line);
  const problems = (relevant.length || request.kind !== 'file' ? relevant : all).slice(0, MAX_PROBLEMS).map((d) => toProblem(path!, d));

  const files: ContextFile[] = [];
  let used = 0;
  const content = path ? await source.read(path) : null;
  if (path && content !== null) {
    const focus = line !== null ? [line] : problems.map((p) => p.line);
    const ex = excerpt(content, focus, MAX_TARGET_CHARS);
    files.push({
      path,
      role: 'target',
      content,
      ...ex,
      totalLines: content.split('\n').length,
    });
    used += ex.shown.length;

    const related: string[] = [];
    for (const spec of importsOf(path, content)) {
      const hit = resolveImport(spec, path, source.files);
      if (hit && !related.includes(hit)) related.push(hit);
    }
    for (const rel of related) {
      if (files.length > MAX_RELATED_FILES) break;
      const budget = MAX_CONTEXT_CHARS - used;
      if (budget < MIN_RELATED_CHARS) break;
      const text = await source.read(rel);
      if (text === null) continue;
      const rx = excerpt(text, [1], budget);
      if (rx.partial && rx.shown.length < MIN_RELATED_CHARS) continue;
      files.push({
        path: rel,
        role: 'related',
        content: text,
        ...rx,
        totalLines: text.split('\n').length,
      });
      used += rx.shown.length;
    }
  }
  return { request, path, line, problems, output, files, chars: used };
}

// ---- Prompt ----

const FORMAT = `Reply in exactly this format and nothing else:

<explanation>
One to three short sentences: what is wrong and what the fix changes. Put code in \`backticks\`.
</explanation>
<edit path="path/from/the/project/root">
<old>
exact lines copied from the file
</old>
<new>
the replacement lines
</new>
</edit>

Rules for edits:
- <old> is copied exactly from the current file, character for character, with the same indentation, and WITHOUT the line numbers and " | " shown before each line.
- <old> must occur exactly once in its file. Include a line or two around the change if needed to make it unique.
- Keep edits small: change only what fixes the problem. Use several <edit> blocks for separate places or files.
- Only edit the files shown. Don't escape characters, don't add code fences.
- If the fix isn't a code change (a missing package, a setting, the environment), explain what to do and give no edits.`;

export const FIX_SYSTEM = `You fix problems in code for Tide, a code editor on iPhone and iPad. The screen is small, so be brief.

${FORMAT}`;

export const EXPLAIN_SYSTEM = `You explain problems in code for Tide, a code editor on iPhone and iPad. The screen is small, so be brief.

Reply with only:

<explanation>
What the problem means, why it happens here, and how to fix it, in a few short sentences or a short list. Put code in \`backticks\`.
</explanation>

Don't give edits or rewrite the file.`;

function describeProblems(problems: FixProblem[]): string {
  return problems.map((p) => `${p.path}:${p.line}:${p.column} ${p.severity}${p.source ? ` [${p.source}]` : ''}: ${p.message}`).join('\n');
}

export function buildPrompt(ctx: FixContext, mode: FixMode, previous?: string): ChatRequest['messages'] {
  const parts: string[] = [];
  for (const f of ctx.files) {
    const range = f.partial ? ` lines="${f.startLine}-${f.endLine} of ${f.totalLines}"` : '';
    const tag = f.role === 'target' ? 'file' : 'related';
    parts.push(`<${tag} path="${f.path}"${range}>\n${f.shown}\n</${tag}>`);
  }
  if (ctx.problems.length) parts.push(`<problems>\n${describeProblems(ctx.problems)}\n</problems>`);
  if (ctx.output) parts.push(`<output>\n${ctx.output}\n</output>`);

  const r = ctx.request;
  const where = ctx.path ?? 'the project';
  const ask =
    r.kind === 'problem'
      ? `the problem${ctx.problems.length === 1 ? '' : 's'} on line ${r.line} of ${where}`
      : r.kind === 'file'
        ? `the problems listed in ${where}`
        : `the error in the program output above${ctx.path ? ` (it points at ${ctx.path}${ctx.line ? `, line ${ctx.line}` : ''})` : ''}`;
  if (mode === 'explain') parts.push(`Explain ${ask}.`);
  else {
    parts.push(`Fix ${ask}.`);
    if (mode === 'retry') {
      parts.push(
        `The user rejected a previous suggestion${previous ? `:\n\n<rejected>\n${previous.trim()}\n</rejected>\n\n` : '. '}Suggest a different fix; don't repeat the same change.`,
      );
    }
  }
  return [{ role: 'user', content: parts.join('\n\n') }];
}

// ---- Parsing ----

export interface ParsedEdit {
  path: string;
  old: string;
  new: string;
}

export interface ParsedReply {
  explanation: string;
  edits: ParsedEdit[];
  // <edit> blocks (or <old>/<new> pairs in them) that couldn't be read.
  malformed: number;
}

// A whole body wrapped in a code fence: the fence goes.
function unfence(s: string): string {
  const m = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(s);
  return m ? m[1] : s;
}

// One newline after the opening tag and one before the closing tag are layout, not text.
function trimBody(s: string): string {
  let out = unfence(s);
  if (out.startsWith('\r\n')) out = out.slice(2);
  else if (out.startsWith('\n')) out = out.slice(1);
  if (out.endsWith('\r\n')) out = out.slice(0, -2);
  else if (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

export function cleanPath(raw: string): string | null {
  const p = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
  if (!p || p.split('/').some((s) => s === '..' || s === '')) return null;
  return p;
}

export function parseFixReply(text: string): ParsedReply {
  const body = text.replace(/<new\s*\/>/g, '<new></new>').replace(/<old\s*\/>/g, '<old></old>');
  const edits: ParsedEdit[] = [];
  let malformed = 0;
  // An <edit> runs to its </edit>, or to the next <edit> or the end when the closing tag is missing.
  const blocks = [...body.matchAll(/<edit\b([^>]*)>([\s\S]*?)(?:<\/edit\s*>|(?=<edit\b)|$)/g)];
  for (const b of blocks) {
    const attr = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(b[1]);
    const path = attr ? cleanPath(attr[1] ?? attr[2] ?? '') : null;
    const pairs = [...b[2].matchAll(/<old>([\s\S]*?)<\/old>\s*<new>([\s\S]*?)<\/new>/g)];
    const opened = (b[2].match(/<old>/g) ?? []).length;
    if (!path || !pairs.length) {
      malformed += Math.max(1, opened);
      continue;
    }
    malformed += Math.max(0, opened - pairs.length);
    for (const p of pairs) edits.push({ path, old: trimBody(p[1]), new: trimBody(p[2]) });
  }

  const tagged = /<explanation>([\s\S]*?)(?:<\/explanation>|(?=<edit\b)|$)/.exec(body);
  let explanation = tagged ? tagged[1] : body.slice(0, blocks.length ? blocks[0].index : undefined);
  explanation = unfence(explanation)
    .replace(/<\/?explanation>/g, '')
    .trim();
  return { explanation, edits, malformed };
}

// ---- Validation ----

const countOf = (hay: string, needle: string): { count: number; at: number } => {
  let count = 0;
  let at = -1;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    if (count === 0) at = i;
    if (++count > 1) break;
  }
  return { count, at };
};

const GUTTER = /^[ \t]*\d+[ \t]*[|│][ \t]?/;

// The ways a model's <old>/<new> may differ from the file that are safe to
// undo: the line-number gutter copied along, and \n where the file uses \r\n.
function variants(old: string, rep: string, content: string): [string, string][] {
  const out: [string, string][] = [[old, rep]];
  const lines = old.split('\n');
  if (lines.filter((l) => l.trim()).every((l) => GUTTER.test(l))) {
    const strip = (s: string) =>
      s
        .split('\n')
        .map((l) => l.replace(GUTTER, ''))
        .join('\n');
    out.push([strip(old), rep.split('\n').every((l) => !l.trim() || GUTTER.test(l)) ? strip(rep) : rep]);
  }
  if (content.includes('\r\n')) {
    for (const [o, n] of [...out]) if (!o.includes('\r')) out.push([o.replace(/\n/g, '\r\n'), n.replace(/\r?\n/g, '\r\n')]);
  }
  return out;
}

export interface Validated {
  changes: FileChange[];
  dropped: number;
}

// Keeps the edits whose `old` occurs exactly once in the file's current text
// (and doesn't overlap another kept edit), and applies them per file.
export function validateEdits(edits: ParsedEdit[], contentOf: (path: string) => string | null): Validated {
  const byPath = new Map<string, { from: number; to: number; text: string }[]>();
  const before = new Map<string, string>();
  let dropped = 0;
  for (const e of edits) {
    const content = before.has(e.path) ? before.get(e.path)! : contentOf(e.path);
    if (content === null) {
      dropped++;
      continue;
    }
    before.set(e.path, content);
    const ranges = byPath.get(e.path) ?? [];
    let hit: { from: number; to: number; text: string } | null = null;
    if (e.old === '') {
      // Only an empty file can take an edit with no anchor.
      if (content.trim() === '' && !ranges.length) hit = { from: 0, to: content.length, text: e.new };
    } else {
      for (const [o, n] of variants(e.old, e.new, content)) {
        const { count, at } = countOf(content, o);
        if (count === 1) {
          hit = { from: at, to: at + o.length, text: n };
          break;
        }
      }
    }
    if (!hit || ranges.some((r) => hit!.from < r.to && hit!.to > r.from) || (hit.from === hit.to && ranges.some((r) => r.from === hit!.from))) {
      dropped++;
      continue;
    }
    ranges.push(hit);
    byPath.set(e.path, ranges);
  }
  const changes: FileChange[] = [];
  for (const [path, ranges] of byPath) {
    const text = before.get(path)!;
    let after = text;
    for (const r of [...ranges].sort((a, b) => b.from - a.from)) after = after.slice(0, r.from) + r.text + after.slice(r.to);
    if (after !== text) changes.push({ path, before: text, after });
  }
  return { changes, dropped };
}

// ---- Asking ----

export interface FixOptions {
  mode?: FixMode;
  // The explanation of the attempt being retried.
  previous?: string;
  signal?: AbortSignal;
  // For tests; defaults to the AI client's chat.
  chat?: (req: ChatRequest) => Promise<ChatResult>;
}

export async function requestFix(ctx: FixContext, { mode = 'fix', previous, signal, chat = defaultChat }: FixOptions = {}): Promise<FixResult> {
  const result = await chat({
    job: 'chat',
    system: mode === 'explain' ? EXPLAIN_SYSTEM : FIX_SYSTEM,
    messages: buildPrompt(ctx, mode, previous),
    maxTokens: mode === 'explain' ? 2000 : 8000,
    signal,
  });
  if (result.stop === 'refusal') throw new AiError(result.refusal ? `The model declined this request: ${result.refusal}` : 'The model declined this request.', 'refusal');
  const parsed = parseFixReply(result.text);
  const known = new Map(ctx.files.map((f) => [f.path, f.content]));
  const { changes, dropped } = mode === 'explain' ? { changes: [], dropped: 0 } : validateEdits(parsed.edits, (p) => known.get(p) ?? null);
  const explanation = parsed.explanation || (parsed.edits.length ? '' : result.text.trim());
  return {
    explanation,
    changes,
    dropped: dropped + (mode === 'explain' ? 0 : parsed.malformed),
    usage: result.usage,
    truncated: result.stop === 'length',
  };
}

// "1.8k tokens"
export function formatTokens(usage: Usage): string {
  const n = usage.inputTokens + usage.outputTokens;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k tokens` : `${n} tokens`;
}
