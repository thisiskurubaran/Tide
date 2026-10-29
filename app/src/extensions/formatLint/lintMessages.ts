import { Diagnostic, lineStarts, offsetAt, Severity } from '../diagnostics';

// What both linters return: 1-based positions, end optional.
export interface LintMessage {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: Severity;
  message: string;
}

export function toDiagnostics(content: string, messages: LintMessage[], source: string): Diagnostic[] {
  const starts = lineStarts(content);
  return messages.map((m) => {
    const from = offsetAt(starts, content, m.line, m.column);
    let to = m.endLine ? offsetAt(starts, content, m.endLine, m.endColumn ?? m.column + 1) : from;
    // Without an end, underline to the end of the word (or one character).
    if (to <= from) {
      const word = /^[\w$]+/.exec(content.slice(from));
      to = from + Math.max(1, word ? word[0].length : 1);
    }
    return { from, to: Math.min(to, content.length), line: m.line, column: m.column, severity: m.severity, message: m.message, source };
  });
}
