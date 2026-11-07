/**
 * @jest-environment node
 */
import { DatabaseSync } from 'node:sqlite';

import { allRows, Db, deleteRow, insertRow, ROWID, tablePage, toCsv, updateCell } from './database';

function nodeDb(db: DatabaseSync): Db {
  return {
    getAllAsync: async <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as T[],
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    execAsync: async (sql: string) => db.exec(sql),
    closeAsync: async () => undefined,
  };
}

describe('editing rows', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE people(name TEXT, age INTEGER DEFAULT 1, note TEXT);
            INSERT INTO people VALUES ('Ada', 36, 'math'), ('Alan', 41, 'says "hi", ok');
            CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
            CREATE VIEW adults AS SELECT name FROM people WHERE age >= 18;`);
  const db = nodeDb(raw);

  it('edits cells by rowid, with NULL and number affinity', async () => {
    const page = await tablePage(db, 'people', 0);
    expect(page.editable).toBe(true);
    expect(page.columns).toEqual(['name', 'age', 'note']);
    const ada = page.rows[0];
    await updateCell(db, 'people', ada[ROWID], 'age', '37');
    await updateCell(db, 'people', ada[ROWID], 'note', 'null');
    const [row] = raw.prepare('SELECT age, note, typeof(age) AS t FROM people WHERE name = ?').all('Ada') as Record<string, unknown>[];
    expect(row).toEqual({ age: 37, note: null, t: 'integer' });
  });

  it('adds rows with defaults for empty fields, and deletes them', async () => {
    await insertRow(db, 'people', { name: 'Grace', age: '', note: '' });
    let page = await tablePage(db, 'people', 0);
    const grace = page.rows.find((r) => r.name === 'Grace')!;
    expect(grace.age).toBe(1);
    await deleteRow(db, 'people', grace[ROWID]);
    page = await tablePage(db, 'people', 0);
    expect(page.rows.map((r) => r.name)).toEqual(['Ada', 'Alan']);
  });

  it('shows views and WITHOUT ROWID tables without editing', async () => {
    expect((await tablePage(db, 'kv', 0)).editable).toBe(false);
    expect((await tablePage(db, 'adults', 0)).editable).toBe(false);
  });

  it('exports CSV with quoting and empty NULLs', async () => {
    const { columns, rows } = await allRows(db, 'people');
    expect(toCsv(columns, rows)).toBe('name,age,note\r\nAda,37,\r\nAlan,41,"says ""hi"", ok"\r\n');
  });
});
