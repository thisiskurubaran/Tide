/**
 * @jest-environment node
 */
import { DatabaseSync } from 'node:sqlite';

import type { Db } from './database';
import { sqliteSchema } from './database';

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

it('reads a SQLite schema: columns, keys and foreign keys', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT DEFAULT 'anon');
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), total REAL);
CREATE TABLE lines (order_id INTEGER, n INTEGER, sku TEXT, PRIMARY KEY (order_id, n), FOREIGN KEY (order_id) REFERENCES orders);
CREATE VIEW big AS SELECT * FROM orders WHERE total > 100;`);
  const schema = await sqliteSchema(nodeDb(db));
  expect(schema.map((t) => `${t.kind}:${t.name}`)).toEqual(['table:lines', 'table:orders', 'table:users', 'view:big']);
  const users = schema.find((t) => t.name === 'users')!;
  expect(users.columns).toEqual([
    { name: 'id', type: 'INTEGER', nullable: false, primary: true, default: null },
    { name: 'email', type: 'TEXT', nullable: false, primary: false, default: null },
    { name: 'name', type: 'TEXT', nullable: true, primary: false, default: "'anon'" },
  ]);
  expect(schema.find((t) => t.name === 'orders')!.foreignKeys).toEqual([{ columns: ['user_id'], table: 'users', to: ['id'] }]);
  const lines = schema.find((t) => t.name === 'lines')!;
  expect(lines.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['order_id', 'n']);
  // No column named: the other table's primary key.
  expect(lines.foreignKeys).toEqual([{ columns: ['order_id'], table: 'orders', to: [''] }]);
});
