// What the command palette's input means. Like VS Code, the first character
// picks what it searches; the rest is the query. Kept pure so it is easy to test.

export type PaletteKind = 'files' | 'commands' | 'symbols' | 'line' | 'text';

export type PaletteQuery =
  | { kind: 'files' | 'commands' | 'symbols' | 'text'; text: string }
  // line is null until a valid number is typed, so the row can show a hint instead.
  | { kind: 'line'; text: string; line: number | null; column?: number };

export const PREFIXES: Record<PaletteKind, string> = { files: '', commands: '>', symbols: '@', line: ':', text: '#' };

const BY_PREFIX: Record<string, PaletteKind> = { '>': 'commands', '@': 'symbols', ':': 'line', '#': 'text' };

export function parsePaletteQuery(input: string): PaletteQuery {
  const kind = BY_PREFIX[input[0] ?? ''] ?? 'files';
  const text = (kind === 'files' ? input : input.slice(1)).trim();
  if (kind !== 'line') return { kind, text };
  // ":42", ":42:7" or ":42,7"; anything else is not a position yet.
  const m = /^(\d+)(?:[:,](\d+))?$/.exec(text);
  const line = m ? Number(m[1]) : 0;
  if (!m || line < 1) return { kind, text, line: null };
  const column = m[2] !== undefined && Number(m[2]) >= 1 ? Number(m[2]) : undefined;
  return column === undefined ? { kind, text, line } : { kind, text, line, column };
}

// Switching prefix (a chip tap) keeps what was typed after the old one.
export function withPrefix(input: string, kind: PaletteKind): string {
  const current = parsePaletteQuery(input).kind;
  const rest = current === 'files' ? input : input.slice(1);
  return PREFIXES[kind] + rest.trimStart();
}

export function initialInput(mode: PaletteKind | null): string {
  return mode ? PREFIXES[mode] : '';
}

// Most recent first, no duplicates, at most `max`.
export function pushRecent(list: readonly string[], id: string, max = 5): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

export interface Segment {
  text: string;
  hit: boolean;
}

// Splits text into runs of matched and unmatched characters for highlighting.
// `positions` are indexes into `text`; out-of-range ones are ignored.
export function highlightSegments(text: string, positions: readonly number[] | null | undefined): Segment[] {
  if (!text) return [];
  const hits = new Set(positions ?? []);
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}

// Positions covering [start, start + length), for search matches.
export const range = (start: number, length: number) => Array.from({ length: Math.max(0, length) }, (_, i) => start + i);
