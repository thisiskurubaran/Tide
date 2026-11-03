// A small TOML reader, enough for ruff.toml and pyproject.toml: tables, dotted
// keys, strings (all four kinds), numbers, booleans, arrays and inline tables.
// Dates and times come back as their text. It is lenient: a value it can't
// read is skipped to the end of its line rather than failing the whole file.
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

const isTable = (v: TomlValue | undefined): v is TomlTable => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  let i = 0;
  // The table key/values go into; null inside [[array tables]], which ruff doesn't use.
  let current: TomlTable | null = root;

  const peek = () => text[i];
  const skipSpace = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  };
  const skipComment = () => {
    if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
  };
  // Spaces, newlines and comments, as inside arrays.
  const skipAll = () => {
    for (;;) {
      const start = i;
      while (i < text.length && /\s/.test(text[i])) i++;
      skipComment();
      if (i === start) return;
    }
  };
  const skipLine = () => {
    while (i < text.length && text[i] !== '\n') i++;
  };
  const fail = (): never => {
    throw new SyntaxError(`TOML: unexpected ${JSON.stringify(text[i] ?? 'end')} at ${i}`);
  };

  const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
  function basicString(): string {
    const multi = text.startsWith('"""', i);
    i += multi ? 3 : 1;
    if (multi && text[i] === '\n') i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail();
      if (multi ? text.startsWith('"""', i) : text[i] === '"') {
        i += multi ? 3 : 1;
        return out;
      }
      if (!multi && text[i] === '\n') fail();
      if (text[i] === '\\') {
        const c = text[i + 1];
        if (c === 'u' || c === 'U') {
          const len = c === 'u' ? 4 : 8;
          out += String.fromCodePoint(parseInt(text.slice(i + 2, i + 2 + len), 16));
          i += 2 + len;
        } else if (multi && /\s/.test(c)) {
          // A line-ending backslash trims the whitespace after it.
          i++;
          while (i < text.length && /\s/.test(text[i])) i++;
        } else {
          out += ESCAPES[c] ?? c;
          i += 2;
        }
        continue;
      }
      out += text[i++];
    }
  }
  function literalString(): string {
    const multi = text.startsWith("'''", i);
    i += multi ? 3 : 1;
    if (multi && text[i] === '\n') i++;
    const end = text.indexOf(multi ? "'''" : "'", i);
    if (end < 0 || (!multi && text.slice(i, end).includes('\n'))) fail();
    const s = text.slice(i, end);
    i = end + (multi ? 3 : 1);
    return s;
  }

  function key(): string {
    skipSpace();
    if (peek() === '"') return basicString();
    if (peek() === "'") return literalString();
    const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i, i + 256));
    if (!m) fail();
    i += m![0].length;
    return m![0];
  }
  function keyPath(): string[] {
    const parts = [key()];
    skipSpace();
    while (peek() === '.') {
      i++;
      parts.push(key());
      skipSpace();
    }
    return parts;
  }

  function value(): TomlValue {
    skipSpace();
    const c = peek();
    if (c === '"') return basicString();
    if (c === "'") return literalString();
    if (c === '[') {
      i++;
      const arr: TomlValue[] = [];
      for (;;) {
        skipAll();
        if (peek() === ']') {
          i++;
          return arr;
        }
        arr.push(value());
        skipAll();
        if (peek() === ',') i++;
        else if (peek() !== ']') fail();
      }
    }
    if (c === '{') {
      i++;
      const table: TomlTable = {};
      skipSpace();
      if (peek() === '}') {
        i++;
        return table;
      }
      for (;;) {
        const path = keyPath();
        if (peek() !== '=') fail();
        i++;
        assign(table, path, value());
        skipSpace();
        if (peek() === ',') i++;
        else if (peek() === '}') {
          i++;
          return table;
        } else fail();
      }
    }
    // Bare: booleans, numbers, dates.
    const m = /^[^\s,\]}#]+/.exec(text.slice(i, i + 256));
    if (!m) fail();
    const word = m![0];
    i += word.length;
    if (word === 'true') return true;
    if (word === 'false') return false;
    const n = word.replace(/_/g, '');
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|inf|nan)$/.test(n)) return Number(n.replace('inf', 'Infinity'));
    if (/^0x[0-9a-f]+$/i.test(n)) return parseInt(n, 16);
    if (/^0o[0-7]+$/.test(n)) return parseInt(n.slice(2), 8);
    if (/^0b[01]+$/.test(n)) return parseInt(n.slice(2), 2);
    // A date or time; it can have a space between them.
    if (/^\d{4}-\d{2}-\d{2}$/.test(word) && /^ \d{2}:/.test(text.slice(i, i + 4))) {
      const rest = /^ [^\s,\]}#]+/.exec(text.slice(i))![0];
      i += rest.length;
      return word + rest;
    }
    if (/^[\d:.+TZ-]+$/i.test(word) && /\d{2}:\d{2}|\d{4}-\d{2}/.test(word)) return word;
    return fail();
  }

  function assign(table: TomlTable, path: string[], v: TomlValue) {
    let t = table;
    for (const p of path.slice(0, -1)) {
      if (!isTable(t[p])) t[p] = {};
      t = t[p] as TomlTable;
    }
    t[path[path.length - 1]] = v;
  }
  function tableAt(path: string[]): TomlTable {
    let t = root;
    for (const p of path) {
      if (!isTable(t[p])) t[p] = {};
      t = t[p] as TomlTable;
    }
    return t;
  }

  while (i < text.length) {
    skipAll();
    if (i >= text.length) break;
    const lineStart = i;
    try {
      if (peek() === '[') {
        const array = text[i + 1] === '[';
        i += array ? 2 : 1;
        const path = keyPath();
        if (text[i] !== ']' || (array && text[i + 1] !== ']')) fail();
        i += array ? 2 : 1;
        current = array ? null : tableAt(path);
      } else {
        const path = keyPath();
        if (peek() !== '=') fail();
        i++;
        const v = value();
        if (current) assign(current, path, v);
      }
      skipSpace();
      skipComment();
      if (i < text.length && text[i] !== '\n' && text[i] !== '\r') fail();
    } catch {
      // Skip what can't be read.
      i = Math.max(i, lineStart);
      skipLine();
    }
  }
  return root;
}

export const tomlTable = (v: TomlValue | undefined): TomlTable | undefined => (isTable(v) ? v : undefined);
