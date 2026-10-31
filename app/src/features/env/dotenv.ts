// .env files: KEY=value lines, as dotenv and most frameworks read them.
// Comments, blank lines and order are kept when Tide changes a value.

export interface EnvLine {
  key: string;
  value: string;
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

export const isValidKey = (key: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"');
    const inner = end > 0 ? v.slice(1, end) : v.slice(1);
    return inner.replace(/\\([nrt"\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c] ?? c);
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    return end > 0 ? v.slice(1, end) : v.slice(1);
  }
  // An unquoted value ends at a comment.
  return v.replace(/\s+#.*$/, '');
}

export function parseDotenv(text: string): EnvLine[] {
  const out = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    let raw = m[2];
    // A double-quoted value can run over several lines.
    if (/^\s*"/.test(raw) && !/^\s*"(?:[^"\\]|\\.)*"\s*(#.*)?$/.test(raw)) {
      while (i + 1 < lines.length && !/(?:^|[^\\])"\s*(#.*)?$/.test(raw.trimStart().slice(1))) raw += `\n${lines[++i]}`;
    }
    out.set(m[1], unquote(raw));
  }
  return [...out].map(([key, value]) => ({ key, value }));
}

export function quoteValue(value: string): string {
  if (value === '') return '';
  if (/^[\w@%+=:,./~-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

// Sets KEY in the file text, in place if it's there, or at the end.
export function setDotenv(text: string, key: string, value: string): string {
  const line = `${key}=${quoteValue(value)}`;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => LINE.exec(l)?.[1] === key);
  if (at >= 0) {
    lines[at] = line;
    return lines.join('\n');
  }
  const body = text.replace(/\n*$/, '');
  return `${body}${body ? '\n' : ''}${line}\n`;
}

export function removeDotenv(text: string, key: string): string {
  return text
    .split('\n')
    .filter((l) => LINE.exec(l)?.[1] !== key)
    .join('\n');
}
