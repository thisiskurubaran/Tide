import { Db, formatCell, isMultiStatement, listTables, quoteIdent, returnsRows, runSql, tablePage } from './database';

function fakeDb(answers: Record<string, unknown[]>) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Db = {
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      calls.push({ sql, params });
      const key = Object.keys(answers).find((k) => sql.includes(k));
      if (!key) throw new Error(`no answer for ${sql}`);
      return answers[key] as T[];
    },
    async runAsync(sql: string) {
      calls.push({ sql, params: [] });
      return { changes: 3, lastInsertRowId: 0 };
    },
    async execAsync(sql: string) {
      calls.push({ sql, params: [] });
    },
    async closeAsync() {},
  };
  return { db, calls };
}

describe('database viewer', () => {
  it('lists tables with row counts, and views', async () => {
    const { db } = fakeDb({
      sqlite_master: [
        { name: 'users', type: 'table' },
        { name: 'active', type: 'view' },
      ],
      'COUNT(*) AS n FROM "users"': [{ n: 42 }],
    });
    expect(await listTables(db)).toEqual([
      { name: 'users', kind: 'table', rows: 42 },
      { name: 'active', kind: 'view', rows: null },
    ]);
  });

  it('pages through a table with quoted names', async () => {
    const { db, calls } = fakeDb({ 'PRAGMA table_info': [{ name: 'id' }, { name: 'name' }], '* FROM': [{ id: 1, name: 'Ada' }] });
    const page = await tablePage(db, 'my "odd" table', 200);
    expect(page).toEqual({ columns: ['id', 'name'], rows: [{ id: 1, name: 'Ada' }], editable: true });
    expect(calls[1]).toEqual({ sql: 'SELECT rowid AS __tide_rowid__, * FROM "my ""odd"" table" LIMIT ? OFFSET ?', params: [100, 200] });
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it('tells queries, changes and scripts apart', async () => {
    expect(returnsRows('  -- note\n select 1')).toBe(true);
    expect(returnsRows('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(returnsRows("UPDATE t SET a = 'select'")).toBe(false);
    expect(isMultiStatement("INSERT INTO t VALUES ('a;b');")).toBe(false);
    expect(isMultiStatement('CREATE TABLE a(x); CREATE TABLE b(y);')).toBe(true);

    const { db, calls } = fakeDb({ 'SELECT name': [{ name: 'Ada', age: 36 }] });
    expect(await runSql(db, 'SELECT name, age FROM people')).toEqual({ kind: 'rows', columns: ['name', 'age'], rows: [{ name: 'Ada', age: 36 }] });
    expect(await runSql(db, 'DELETE FROM people')).toEqual({ kind: 'changes', changes: 3 });
    expect(await runSql(db, 'CREATE TABLE a(x); CREATE TABLE b(y);')).toEqual({ kind: 'done' });
    expect(calls.map((c) => c.sql)).toEqual(['SELECT name, age FROM people', 'DELETE FROM people', 'CREATE TABLE a(x); CREATE TABLE b(y);']);
  });

  it('formats cells', () => {
    expect(formatCell(null)).toEqual({ text: 'NULL', muted: true });
    expect(formatCell(new Uint8Array(4))).toEqual({ text: 'BLOB · 4 bytes', muted: true });
    expect(formatCell(3.5)).toEqual({ text: '3.5', muted: false });
    expect(formatCell('x'.repeat(300)).text).toHaveLength(201);
  });
});
