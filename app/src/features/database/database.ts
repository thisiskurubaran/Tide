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

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  default: string | null;
}

export interface ForeignKey {
  columns: string[];
  table: string;
  to: string[];
}

export interface SchemaTable {
  name: string;
  kind: 'table' | 'view';
  columns: SchemaColumn[];
  foreignKeys: ForeignKey[];
}

export async function sqliteSchema(db: Db): Promise<SchemaTable[]> {
  const out: SchemaTable[] = [];
  for (const t of await listTables(db)) {
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(`PRAGMA table_info(${quoteIdent(t.name)})`);
    const fks = await db.getAllAsync<{ id: number; seq: number; table: string; from: string; to: string | null }>(`PRAGMA foreign_key_list(${quoteIdent(t.name)})`).catch(() => []);
    const byId = new Map<number, ForeignKey>();
    for (const f of [...fks].sort((a, b) => a.id - b.id || a.seq - b.seq)) {
      const fk = byId.get(f.id) ?? { columns: [], table: f.table, to: [] };
      fk.columns.push(f.from);
      // No column named means the other table's primary key.
      fk.to.push(f.to ?? '');
      byId.set(f.id, fk);
    }
    out.push({
      name: t.name,
      kind: t.kind,
      columns: cols.map((c) => ({ name: c.name, type: c.type || 'ANY', nullable: !c.notnull && !c.pk, primary: c.pk > 0, default: c.dflt_value })),
      foreignKeys: [...byId.values()],
    });
  }
  return out;
}

// Each row's rowid rides along under this name, so a row can be edited or deleted.
export const ROWID = '__tide_rowid__';

export async function tablePage(db: Db, table: string, offset: number): Promise<{ columns: string[]; rows: Row[]; editable: boolean }> {
  const columns = await tableColumns(db, table);
  let rows: Row[];
  let editable = true;
  try {
    rows = await db.getAllAsync<Row>(`SELECT rowid AS ${ROWID}, * FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`, PAGE_SIZE, offset);
  } catch {
    // Views and WITHOUT ROWID tables: shown, not edited.
    editable = false;
    rows = await db.getAllAsync<Row>(`SELECT * FROM ${quoteIdent(table)} LIMIT ? OFFSET ?`, PAGE_SIZE, offset);
  }
  return { columns: columns.length ? columns : Object.keys(rows[0] ?? {}).filter((c) => c !== ROWID), rows, editable };
}

// What's typed in an edit box: NULL (any case) means SQL NULL; SQLite's column
// affinity turns "42" into a number in a numeric column.
export const parseValue = (text: string): string | null => (text.trim().toUpperCase() === 'NULL' ? null : text);

export async function updateCell(db: Db, table: string, rowid: unknown, column: string, text: string) {
  await db.runAsync(`UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`, parseValue(text), rowid);
}

export async function deleteRow(db: Db, table: string, rowid: unknown) {
  await db.runAsync(`DELETE FROM ${quoteIdent(table)} WHERE rowid = ?`, rowid);
}

// Columns left empty get their default.
export async function insertRow(db: Db, table: string, values: Record<string, string>) {
  const set = Object.entries(values).filter(([, v]) => v !== '');
  if (!set.length) return db.runAsync(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`);
  return db.runAsync(
    `INSERT INTO ${quoteIdent(table)} (${set.map(([c]) => quoteIdent(c)).join(', ')}) VALUES (${set.map(() => '?').join(', ')})`,
    ...set.map(([, v]) => parseValue(v)),
  );
}

// RFC 4180 CSV: a header row, then the rows. NULL is an empty field; blobs are base64.
export function toCsv(columns: string[], rows: Row[]): string {
  const field = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Uint8Array ? btoa(String.fromCharCode(...v)) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(field).join(','), ...rows.map((r) => columns.map((c) => field(r[c])).join(','))].join('\r\n') + '\r\n';
}

// Every row of a table, for export (tablePage pages through it for the screen).
export async function allRows(db: Db, table: string): Promise<{ columns: string[]; rows: Row[] }> {
  const columns = await tableColumns(db, table);
  return { columns, rows: await db.getAllAsync<Row>(`SELECT * FROM ${quoteIdent(table)}`) };
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
