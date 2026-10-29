// Reading and querying a SQLite file in the project, for the database viewer.
// `Db` is the slice of expo-sqlite's database the viewer uses, so tests can fake it.
export interface Db {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  execAsync(sql: string): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface TableInfo {
  name: string;
  kind: 'table' | 'view';
  rows: number | null;
}

export type Row = Record<string, unknown>;

export type QueryResult = { kind: 'rows'; columns: string[]; rows: Row[] } | { kind: 'changes'; changes: number } | { kind: 'done' };

export const PAGE_SIZE = 100;

// Identifiers can't be bound as parameters, so they're quoted instead.
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function listTables(db: Db): Promise<TableInfo[]> {
  const items = await db.getAllAsync<{ name: string; type: 'table' | 'view' }>(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  const out: TableInfo[] = [];
  for (const t of items) {
    let rows: number | null = null;
    // Views can be slow to count; tables are cheap enough.
    if (t.type === 'table') {
      const [r] = await db.getAllAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdent(t.name)}`).catch(() => [{ n: -1 }]);
      rows = r && r.n >= 0 ? r.n : null;
    }
    out.push({ name: t.name, kind: t.type, rows });
  }
  return out;
}

export async function tableColumns(db: Db, table: string): Promise<string[]> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.map((c) => c.name);
}

export async function tablePage(db: Db, table: string, offset: number): Promise<{ columns: string[]; rows: Row[] }> {
  const columns = await tableColumns(db, table);
  const rows = await db.getAllAsync<Row>(`SELECT * FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`, PAGE_SIZE, offset);
  return { columns: columns.length ? columns : Object.keys(rows[0] ?? {}), rows };
}

// Strips comments and string literals, so keywords and semicolons inside them don't count.
const code = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');

// More than one statement goes through exec, which returns nothing.
export function isMultiStatement(sql: string): boolean {
  return code(sql)
    .split(';')
    .filter((s) => s.trim()).length > 1;
}

// Statements that return rows.
export function returnsRows(sql: string): boolean {
  return /^\s*(select|pragma|with|explain|values)\b/i.test(code(sql));
}

export async function runSql(db: Db, sql: string): Promise<QueryResult> {
  if (!sql.trim()) return { kind: 'done' };
  if (isMultiStatement(sql)) {
    await db.execAsync(sql);
    return { kind: 'done' };
  }
  if (returnsRows(sql)) {
    const rows = await db.getAllAsync<Row>(sql);
    return { kind: 'rows', columns: Object.keys(rows[0] ?? {}), rows };
  }
  const { changes } = await db.runAsync(sql);
  return { kind: 'changes', changes };
}

const MAX_CELL = 200;

// How a value shows in the grid.
export function formatCell(value: unknown): { text: string; muted: boolean } {
  if (value === null || value === undefined) return { text: 'NULL', muted: true };
  if (value instanceof Uint8Array) return { text: `BLOB · ${value.length} bytes`, muted: true };
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return { text: text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text, muted: false };
}
