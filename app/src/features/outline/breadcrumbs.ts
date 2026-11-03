// What the cursor is inside, for the breadcrumbs above the editor: the chain
// of symbols (class › method) whose scope contains the line. Scopes come from
// indentation, since the outline has no end lines: a symbol's scope ends at
// the first later line indented no deeper (taking that line in if it's the
// closing bracket).
// Markdown headings nest by level instead.
import type { CodeSymbol } from './symbols';

const indent = (line: string) => {
  const m = /^[ \t]*/.exec(line)![0];
  return m.replace(/\t/g, '    ').length;
};
const closes = (line: string) => /^\s*([}\])]|end\b|<\/)/.test(line);

export function scopeEnd(lines: string[], symbol: CodeSymbol): number {
  const start = symbol.line - 1;
  const base = indent(lines[start] ?? '');
  for (let i = start + 1; i < lines.length; i++) {
    const text = lines[i];
    if (!text.trim()) continue;
    // i is the 0-based index, so it's also the 1-based number of the line before.
    if (indent(text) <= base) return closes(text) ? i + 1 : i;
  }
  return lines.length;
}

export function symbolsAt(symbols: CodeSymbol[], lines: string[], line: number): CodeSymbol[] {
  const headings = symbols.filter((s) => s.kind === 'heading');
  if (headings.length && headings.length === symbols.length) {
    // Markdown: the last heading at or before the line, and its parents.
    const chain: CodeSymbol[] = [];
    for (const h of headings) {
      if (h.line > line) break;
      while (chain.length && chain[chain.length - 1].depth >= h.depth) chain.pop();
      chain.push(h);
    }
    return chain;
  }
  return symbols.filter((s) => s.kind !== 'heading' && s.line <= line && line <= scopeEnd(lines, s)).sort((a, b) => a.line - b.line);
}
