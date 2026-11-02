// Converts between the VS Code language services' LSP shapes and what the
// editor uses. Pure functions with type-only imports, so jest can test them
// without loading the services.
import type { CompletionItem, Hover, MarkedString, MarkupContent, Range } from 'vscode-css-languageservice';

import type { EditorDiagnostic, Language } from '../../../src/features/editor/bridge';

export type ServiceKind = 'css' | 'scss' | 'less' | 'html' | 'json';

// JSON with comments and trailing commas allowed, as the tools that read them do.
const JSONC = /(^|\/)(tsconfig(\..*)?\.json|jsconfig(\..*)?\.json|\.eslintrc(\.json)?|\.babelrc(\.json)?|\.swcrc|\.jshintrc|\.vscode\/[^/]+\.json|[^/]+\.jsonc)$/i;

// Large files open as 'plain', so they never get a service.
export function serviceKind(lang: Language): ServiceKind | null {
  switch (lang) {
    case 'css':
    case 'scss':
    case 'less':
    case 'html':
    case 'json':
      return lang;
    default:
      return null;
  }
}

export const isJsonc = (path: string) => JSONC.test(path);

// URIs for the services; schema fileMatch globs are matched against them.
export const uriFor = (path: string) => 'file:///' + path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');

// ---- Embedded CSS in HTML ----

export interface Region {
  kind: 'css' | 'js';
  from: number;
  to: number;
}

// <style> and <script> bodies. A tolerant scan: an unclosed tag runs to the end.
export function embeddedRegions(text: string): Region[] {
  const out: Region[] = [];
  const open = /<(style|script)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const name = m[1].toLowerCase();
    const from = m.index + m[0].length;
    const close = text.toLowerCase().indexOf(`</${name}`, from);
    const to = close === -1 ? text.length : close;
    // Only JavaScript scripts; templates and JSON blocks are left alone.
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[0])?.[1].toLowerCase();
    const js = !type || type === 'module' || type.includes('javascript');
    if (name === 'style') out.push({ kind: 'css', from, to });
    else if (js) out.push({ kind: 'js', from, to });
    open.lastIndex = to;
  }
  return out;
}

export const regionAt = (regions: Region[], offset: number) => regions.find((r) => offset >= r.from && offset <= r.to) ?? null;

// The CSS of an HTML file at the same offsets: everything outside <style>
// becomes spaces (newlines kept), so positions need no mapping.
export function cssView(text: string, regions: Region[]): string {
  let out = '';
  let at = 0;
  for (const r of regions) {
    if (r.kind !== 'css') continue;
    out += blank(text.slice(at, r.from)) + text.slice(r.from, r.to);
    at = r.to;
  }
  return out + blank(text.slice(at));
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

// ---- Positions ----

export interface LineIndex {
  offsetAt(pos: { line: number; character: number }): number;
}

export function lineIndex(text: string): LineIndex {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return {
    offsetAt({ line, character }) {
      if (line >= starts.length) return text.length;
      const start = starts[Math.max(0, line)];
      const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
      return Math.min(start + Math.max(0, character), end);
    },
  };
}

const rangeOffsets = (index: LineIndex, r: Range) => ({ from: index.offsetAt(r.start), to: index.offsetAt(r.end) });

// ---- Completions ----

// LSP CompletionItemKind -> CodeMirror's completion icon types.
const KIND_TYPES: Record<number, string> = {
  1: 'text',
  2: 'method',
  3: 'function',
  4: 'function',
  5: 'property',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'namespace',
  10: 'property',
  11: 'constant',
  12: 'enum',
  13: 'enum',
  14: 'keyword',
  15: 'text',
  16: 'constant',
  17: 'text',
  18: 'text',
  19: 'text',
  20: 'enum',
  21: 'constant',
  22: 'type',
  23: 'text',
  24: 'keyword',
  25: 'type',
};

export interface ServiceCompletion {
  // What CodeMirror matches the typed text against (the LSP filterText).
  label: string;
  displayLabel?: string;
  type?: string;
  detail?: string;
  info?: string;
  boost?: number;
  // Replaces from..to (offsets when the list was computed); a CodeMirror snippet template if `snippet`.
  from: number;
  to: number;
  insert: string;
  snippet: boolean;
  // CSS properties reopen the list after inserting "name: ", for the value.
  retrigger: boolean;
}

export function toCompletion(item: CompletionItem, index: LineIndex, offset: number, fallbackFrom: number, boost?: number): ServiceCompletion {
  // A TextEdit or an InsertReplaceEdit; the replace range is what completing replaces.
  const edit = item.textEdit as { range: Range; newText: string } | { replace: Range; newText: string } | undefined;
  const range = edit ? ('range' in edit ? edit.range : edit.replace) : null;
  const { from, to } = range ? rangeOffsets(index, range) : { from: fallbackFrom, to: offset };
  const raw = edit?.newText ?? item.insertText ?? item.label;
  const snippet = item.insertTextFormat === 2;
  const label = item.filterText ?? item.label;
  return {
    label,
    displayLabel: label !== item.label ? item.label : undefined,
    type: item.kind ? KIND_TYPES[item.kind] : undefined,
    detail: item.detail,
    info: docText(item.documentation),
    boost,
    from,
    to,
    insert: snippet ? lspSnippet(raw) : raw,
    snippet,
    retrigger: item.command?.command === 'editor.action.triggerSuggest',
  };
}

// The services order items by sortText; CodeMirror sorts by match quality,
// then boost (-99..99). Ranking by sortText keeps the services' order among
// equally good matches, so `color` comes before `color-interpolation`.
export function rankBoosts(items: CompletionItem[]): number[] {
  const keys = items.map((i, n) => ({ n, key: i.sortText ?? i.label }));
  keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Array<number>(items.length);
  const span = Math.max(1, keys.length - 1);
  keys.forEach(({ n }, rank) => (out[n] = Math.round(99 - (198 * rank) / span)));
  return out;
}

// LSP snippet syntax -> CodeMirror's: $1 and ${1:x} become ${1} and ${1:x},
// choices keep their first option, and literal braces are escaped.
export function lspSnippet(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && '$}\\'.includes(text[i + 1])) {
      const next = text[++i];
      out += next === '}' ? '\\}' : next;
    } else if (c === '$') {
      const rest = text.slice(i);
      let m: RegExpExecArray | null;
      if ((m = /^\$(\d+)/.exec(rest))) out += `\${${m[1]}}`;
      else if ((m = /^\$\{(\d+):((?:\\.|[^}\\])*)\}/.exec(rest))) out += `\${${m[1]}:${m[2].replace(/\\(.)/g, '$1').replace(/[{}]/g, '')}}`;
      else if ((m = /^\$\{(\d+)\|([^,|]*)[^|]*\|\}/.exec(rest))) out += `\${${m[1]}:${m[2]}}`;
      else if ((m = /^\$\{(\d+)\}/.exec(rest))) out += `\${${m[1]}}`;
      else if ((m = /^\$(?:\{[A-Z_]+(?::[^}]*)?\}|[A-Z_]+)/.exec(rest))) out += '';
      else {
        out += '$';
        continue;
      }
      i += m[0].length - 1;
    } else if (c === '{' || c === '}') out += '\\' + c;
    else out += c;
  }
  return out;
}

// ---- Hover ----

// Markdown -> plain text for the hover box: code fences unwrapped, links
// reduced to their text, MDN reference links and images dropped (no browser
// to open them, and the baseline icons are data URLs).
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', nbsp: ' ', '#39': "'" };

export function markdownText(md: string): string {
  return md
    .replace(/```\w*\n?([\s\S]*?)\n?```/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)\s*/g, '')
    .replace(/^\[[^\]]*\]\([^)]*\)(\s*\|\s*\[[^\]]*\]\([^)]*\))*\s*$/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|[.,;:]|$)/gm, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|])/g, '$1')
    .replace(/&(lt|gt|amp|quot|nbsp|#39);/g, (_, e: string) => ENTITIES[e])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function docText(doc: string | MarkupContent | undefined): string | undefined {
  if (!doc) return undefined;
  const text = typeof doc === 'string' ? doc : doc.kind === 'markdown' ? markdownText(doc.value) : doc.value;
  return text || undefined;
}

export interface HoverText {
  // A code-like first part (a selector, an element), shown monospace.
  code?: string;
  text: string;
  from: number;
  to: number;
}

export function toHover(hover: Hover, index: LineIndex, offset: number): HoverText | null {
  const parts = (Array.isArray(hover.contents) ? hover.contents : [hover.contents]) as (MarkedString | MarkupContent)[];
  let code: string | undefined;
  const texts: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') texts.push(markdownText(p));
    else if ('language' in p) code = code ?? p.value;
    else {
      // CSS hovers start with a ```css block naming the selector.
      const fence = /^```\w*\n([\s\S]*?)\n```\s*/.exec(p.value);
      if (fence && !code) {
        code = fence[1];
        texts.push(docText({ kind: p.kind, value: p.value.slice(fence[0].length) }) ?? '');
      } else texts.push(docText(p) ?? '');
    }
  }
  const text = texts.filter(Boolean).join('\n\n');
  if (!text && !code) return null;
  const { from, to } = hover.range ? rangeOffsets(index, hover.range) : { from: offset, to: offset };
  return { code, text, from, to };
}

// ---- Diagnostics ----

const SEVERITIES: Record<number, EditorDiagnostic['severity']> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };

// Structural, because the JSON service ships a newer LSP types package than the others.
interface ServiceDiagnostic {
  range: Range;
  severity?: number;
  message: string | { value: string };
}

export function toDiagnostics(items: ServiceDiagnostic[], index: LineIndex, source: string): EditorDiagnostic[] {
  return items.map((d) => {
    const { from, to } = rangeOffsets(index, d.range);
    return { from, to, severity: SEVERITIES[d.severity ?? 1], message: typeof d.message === 'string' ? d.message : d.message.value, source };
  });
}

// ---- Colors ----

export interface RGBA {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export const cssColor = (c: RGBA) =>
  `rgba(${Math.round(c.red * 255)}, ${Math.round(c.green * 255)}, ${Math.round(c.blue * 255)}, ${+c.alpha.toFixed(3)})`;

const hex2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
export const hexColor = (c: RGBA) => `#${hex2(c.red)}${hex2(c.green)}${hex2(c.blue)}`;

export function parseHex(hex: string, alpha: number): RGBA | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255, alpha };
}

// Picks the presentation in the same notation as the color being replaced.
export function samePresentation(original: string, labels: string[]): string | undefined {
  const s = original.trim().toLowerCase();
  const prefix = s.startsWith('#') ? '#' : /^(rgb|hsl|hwb|lab|lch|oklab|oklch)/.exec(s)?.[1] ?? '#';
  return labels.find((l) => l.toLowerCase().startsWith(prefix)) ?? labels[0];
}
