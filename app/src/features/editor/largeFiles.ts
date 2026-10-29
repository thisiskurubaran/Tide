// Big files slow the editor down: syntax highlighting, folding and the
// minimap all walk the whole document. Past LARGE they open as plain text
// with those off; past TOO_LARGE, or when binary, they don't open at all.
export const LARGE_CHARS = 500_000;
export const LARGE_LINES = 20_000;
export const TOO_LARGE_BYTES = 10 * 1024 * 1024;

export type FileClass = 'normal' | 'large' | 'binary';

export function classify(content: string): FileClass {
  // NUL bytes don't occur in text files.
  if (content.slice(0, 8000).includes('\u0000')) return 'binary';
  if (content.length > LARGE_CHARS) return 'large';
  let lines = 1;
  for (let i = content.indexOf('\n'); i !== -1; i = content.indexOf('\n', i + 1)) {
    if (++lines > LARGE_LINES) return 'large';
  }
  return 'normal';
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
