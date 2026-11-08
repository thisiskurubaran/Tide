// Trim trailing whitespace and insert a final newline when a file is saved.
// Pure: the rules come from Settings and the file's .editorconfig.
import type { FileFormatting } from './editorconfig';

export interface SaveRules {
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  // Markdown: two or more trailing spaces after text are a line break, so
  // they are kept.
  markdown: boolean;
}

// Settings first, then .editorconfig wins for the file wherever it says something.
export function saveRules(settings: { trimTrailingWhitespace?: boolean; insertFinalNewline?: boolean }, config: FileFormatting, markdown: boolean): SaveRules {
  return {
    trimTrailingWhitespace: config.trimTrailingWhitespace ?? settings.trimTrailingWhitespace === true,
    insertFinalNewline: config.insertFinalNewline ?? settings.insertFinalNewline === true,
    markdown,
  };
}

const MARKDOWN_BREAK = /\S {2,}$/;

// `keepLine` (0-based) is left as it is: the line being typed on during an
// autosave, so a space typed before a pause isn't taken away. A final
// newline isn't added then either if that line is the last one.
export function formatOnSave(content: string, rules: SaveRules, keepLine: number | null = null): string {
  let out = content;
  if (rules.trimTrailingWhitespace) {
    const lines = out.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i === keepLine) continue;
      const line = lines[i];
      const cr = line.endsWith('\r') ? '\r' : '';
      const body = cr ? line.slice(0, -1) : line;
      if (rules.markdown && MARKDOWN_BREAK.test(body)) continue;
      const trimmed = body.replace(/[ \t\f\v ]+$/, '');
      if (trimmed !== body) lines[i] = trimmed + cr;
    }
    out = lines.join('\n');
  }
  if (rules.insertFinalNewline && out.length > 0 && !out.endsWith('\n')) {
    const lastLine = out.split('\n').length - 1;
    if (keepLine !== lastLine) out += out.includes('\r\n') ? '\r\n' : '\n';
  }
  return out;
}

// The 0-based line `offset` is on.
export function lineAt(content: string, offset: number): number {
  let line = 0;
  const end = Math.min(Math.max(0, offset), content.length);
  for (let i = content.indexOf('\n'); i !== -1 && i < end; i = content.indexOf('\n', i + 1)) line++;
  return line;
}
