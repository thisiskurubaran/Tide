// Tables from CSV/TSV text or Parquet, with sorting, filtering, column stats
// and grouped values for a chart. Values stay strings; numbers are recognised
// per column so they sort and sum as numbers.

export interface Table {
  columns: string[];
  rows: string[][];
  // True when the file had more rows than were read.
  truncated: boolean;
}

export const MAX_ROWS = 100_000;

// The delimiter used most consistently over the first lines.
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/, 20).filter((l) => l.trim());
  let best = ',';
  let bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 100 + counts[0];
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

// RFC 4180: quoted fields may hold the delimiter, quotes ("") and newlines.
export function parseCsv(text: string, { delimiter, header = true, maxRows = MAX_ROWS }: { delimiter?: string; header?: boolean; maxRows?: number } = {}): Table {
  const d = delimiter ?? detectDelimiter(text);
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let truncated = false;
  const limit = maxRows + (header ? 1 : 0);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) records.push(row);
      row = [];
      if (records.length >= limit) {
        truncated = src.slice(i + 1).trim().length > 0;
        break;
      }
    } else field += c;
  }
  if (!truncated && (field !== '' || row.length)) {
    row.push(field);
    records.push(row);
  }
  const width = records.reduce((n, r) => Math.max(n, r.length), 0);
  const columns = header && records.length ? records.shift()!.map((c, i) => c.trim() || `Column ${i + 1}`) : [];
  while (columns.length < width) columns.push(`Column ${columns.length + 1}`);
  const rows = records.map((r) => (r.length < columns.length ? [...r, ...Array(columns.length - r.length).fill('')] : r));
  return { columns, rows, truncated };
}

const NUMBER = /^[-+]?(\d+([.,]\d{3})*|\d*)([.]\d+)?([eE][-+]?\d+)?$/;
export const toNumber = (v: string): number | null => {
  const t = v.trim();
  if (!t || !NUMBER.test(t) || t === '-' || t === '+' || t === '.') return null;
  const n = Number(t.replace(/,(?=\d{3}(\D|$))/g, ''));
  return Number.isFinite(n) ? n : null;
};

// A column is numeric when its non-empty values (all of the first 1,000) are numbers.
export function isNumeric(table: Table, column: number): boolean {
  let seen = 0;
  for (const r of table.rows) {
    const v = r[column] ?? '';
    if (!v.trim()) continue;
    if (toNumber(v) === null) return false;
    if (++seen >= 1000) break;
  }
  return seen > 0;
}

export type SortDir = 'asc' | 'desc';

export function sortRows(table: Table, column: number, dir: SortDir): string[][] {
  const numeric = isNumeric(table, column);
  const sign = dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...table.rows].sort((a, b) => {
    const x = a[column] ?? '';
    const y = b[column] ?? '';
    // Empty cells go last either way.
    if (!x.trim() || !y.trim()) return !x.trim() === !y.trim() ? 0 : !x.trim() ? 1 : -1;
    if (numeric) return sign * ((toNumber(x) ?? 0) - (toNumber(y) ?? 0));
    return sign * collator.compare(x, y);
  });
}

// Rows with a cell containing every word of the query (case-insensitive).
// "column:value" limits a word to one column.
export function filterRows(table: Table, rows: string[][], query: string): string[][] {
  const words = query.toLowerCase().match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  if (!words.length) return rows;
  const lower = table.columns.map((c) => c.toLowerCase());
  const tests = words.map((w) => {
    const m = /^([^:]+):(.*)$/.exec(w);
    const col = m ? lower.indexOf(m[1].replace(/"/g, '')) : -1;
    const value = (m && col >= 0 ? m[2] : w).replace(/"/g, '');
    return (r: string[]) => (col >= 0 ? (r[col] ?? '').toLowerCase().includes(value) : r.some((c) => c.toLowerCase().includes(value)));
  });
  return rows.filter((r) => tests.every((t) => t(r)));
}

export interface ColumnStats {
  name: string;
  numeric: boolean;
  count: number;
  empty: number;
  distinct: number;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  // Most common values, for text columns.
  top?: { value: string; count: number }[];
}

export function columnStats(table: Table, column: number): ColumnStats {
  const numeric = isNumeric(table, column);
  const counts = new Map<string, number>();
  let empty = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const r of table.rows) {
    const v = r[column] ?? '';
    if (!v.trim()) {
      empty++;
      continue;
    }
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (numeric) {
      const x = toNumber(v);
      if (x === null) continue;
      sum += x;
      n++;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  }
  const stats: ColumnStats = { name: table.columns[column], numeric, count: table.rows.length, empty, distinct: counts.size };
  if (numeric && n) Object.assign(stats, { min, max, sum, mean: sum / n });
  if (!numeric)
    stats.top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  return stats;
}

export type Aggregate = 'count' | 'sum' | 'mean';

// Bars for a chart: rows grouped by one column, with a count or the sum or
// mean of a numeric column; biggest first, at most `limit` groups.
export function groupBy(rows: string[][], by: number, value: number | null, aggregate: Aggregate, limit = 30): { label: string; value: number }[] {
  const groups = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const key = (r[by] ?? '').trim() || '(empty)';
    const g = groups.get(key) ?? { sum: 0, n: 0 };
    const x = value === null ? null : toNumber(r[value] ?? '');
    if (aggregate !== 'count' && x === null) continue;
    g.sum += x ?? 0;
    g.n++;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([label, g]) => ({ label, value: aggregate === 'count' ? g.n : aggregate === 'sum' ? g.sum : g.sum / g.n }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
