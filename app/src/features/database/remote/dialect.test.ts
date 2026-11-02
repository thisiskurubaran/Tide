/**
 * @jest-environment node
 */
/// <reference types="node" />
// Runs against real servers when they're given, e.g.
//   TIDE_TEST_POSTGRES='{"host":"127.0.0.1","port":5432,"user":"postgres","password":"pw","database":"postgres"}'
//   TIDE_TEST_MYSQL='{"host":"127.0.0.1","port":3306,"user":"tide","password":"pw","database":"shop"}'
// through tide:sql, the same program the app runs. Each test makes its own tables.
import { ChildProcess, spawn } from 'child_process';
import path from 'path';

import { ROWID } from '../database';
import type { SqlClient, SqlResult } from './client';
import { remoteSource, ServerKind } from './dialect';

const CLI = path.join(__dirname, '../../../../nodejs-assets/nodejs-project/sql/cli.js');

function connect(kind: ServerKind, config: object): Promise<SqlClient> {
  const child: ChildProcess = spawn(process.execPath, [CLI], { env: { ...process.env, TIDE_SQL: JSON.stringify({ kind, ssl: 'off', ...config }) } });
  const waiting = new Map<number, { resolve: (r: SqlResult) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let buffer = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    child.stderr!.on('data', (d) => (stderr += d));
    child.on('exit', () => reject(new Error(stderr)));
    child.stdout!.on('data', (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const reply = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (reply.type === 'ready') {
          resolve({
            query: (sql, params = []) =>
              new Promise((res, rej) => {
                const id = ++seq;
                waiting.set(id, { resolve: res, reject: rej });
                child.stdin!.write(`${JSON.stringify({ id, sql, params })}\n`);
              }),
            close: async () => {
              child.stdin!.end();
            },
          });
          continue;
        }
        const w = waiting.get(reply.id)!;
        waiting.delete(reply.id);
        if (reply.ok) w.resolve(reply);
        else w.reject(new Error(reply.error));
      }
    });
  });
}

const servers: [ServerKind, string | undefined][] = [
  ['postgres', process.env.TIDE_TEST_POSTGRES],
  ['mysql', process.env.TIDE_TEST_MYSQL],
];

describe.each(servers)('%s', (kind, configText) => {
  const run = configText ? it : it.skip;
  const t = `tide_test_${Date.now().toString(36)}`;

  run('lists tables, pages rows by primary key, edits, adds, deletes and runs SQL', async () => {
    const client = await connect(kind, JSON.parse(configText!));
    const src = remoteSource(client, kind);
    const serial = kind === 'postgres' ? 'serial PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';
    try {
      expect(await src.run(`CREATE TABLE ${t} (id ${serial}, name VARCHAR(40), score INT); CREATE TABLE ${t}_nokey (msg VARCHAR(40))`)).toEqual({ kind: 'done' });
      expect(await src.run(`INSERT INTO ${t} (name, score) VALUES ('Ada', 1), ('Grace', 2), ('Linus', 3)`)).toEqual({ kind: 'changes', changes: 3 });

      const tables = await src.listTables();
      expect(tables.find((x) => x.name === t)).toMatchObject({ kind: 'table' });
      expect(tables.some((x) => x.name === `${t}_nokey`)).toBe(true);

      const page = await src.page(t, 0);
      expect(page.columns).toEqual(['id', 'name', 'score']);
      expect(page.editable).toBe(true);
      expect(page.rows.map((r) => r.name)).toEqual(['Ada', 'Grace', 'Linus']);
      expect(page.rows[0][ROWID]).toEqual(['1']);

      await src.updateCell(t, page.rows[1], 'score', '20');
      await src.updateCell(t, page.rows[0], 'name', 'NULL');
      await src.deleteRow(t, page.rows[2]);
      await src.insertRow(t, { name: 'Margaret', score: '' });
      await src.insertRow(t, {});

      const after = await src.page(t, 0);
      expect(after.rows.map((r) => [r.name, r.score])).toEqual([
        [null, '1'],
        ['Grace', '20'],
        ['Margaret', null],
        [null, null],
      ]);
      // A row that's gone says so instead of silently doing nothing.
      await expect(src.updateCell(t, page.rows[2], 'name', 'x')).rejects.toThrow('gone');

      expect((await src.page(`${t}_nokey`, 0)).editable).toBe(false);
      expect(await src.allRows(t)).toMatchObject({ columns: ['id', 'name', 'score'] });
      expect(await src.run(`SELECT name FROM ${t} WHERE score = 20`)).toEqual({ kind: 'rows', columns: ['name'], rows: [{ name: 'Grace' }] });
      await expect(src.run('SELECT nope_column')).rejects.toThrow(/nope_column/);

      // The schema, with a foreign key between two of the test's tables.
      await src.run(`CREATE TABLE ${t}_orders (id INT PRIMARY KEY, owner INT, FOREIGN KEY (owner) REFERENCES ${t} (id))`);
      const schema = await src.schema();
      const main = schema.find((x) => x.name === t)!;
      expect(main.columns.map((c) => [c.name, c.primary, c.nullable])).toEqual([
        ['id', true, false],
        ['name', false, true],
        ['score', false, true],
      ]);
      expect(main.columns[1].type).toMatch(/varchar|character varying/i);
      expect(schema.find((x) => x.name === `${t}_orders`)!.foreignKeys).toEqual([{ columns: ['owner'], table: t, to: ['id'] }]);
      expect(schema.find((x) => x.name === `${t}_nokey`)!.columns.every((c) => !c.primary)).toBe(true);
      await src.run(`DROP TABLE ${t}_orders`);

      if (kind === 'postgres') {
        // Tables outside public are listed and read with their schema.
        await src.run(`CREATE SCHEMA ${t}_s; CREATE TABLE ${t}_s.notes (id int PRIMARY KEY, body text); INSERT INTO ${t}_s.notes VALUES (1, 'hi'); CREATE VIEW ${t}_v AS SELECT 1 AS one`);
        const listed = await src.listTables();
        expect(listed.find((x) => x.name === `${t}_v`)).toMatchObject({ kind: 'view' });
        const notes = await src.page(`${t}_s.notes`, 0);
        expect(notes.rows).toEqual([{ id: '1', body: 'hi', [ROWID]: ['1'] }]);
        await src.updateCell(`${t}_s.notes`, notes.rows[0], 'body', 'hello');
        expect((await src.page(`${t}_s.notes`, 0)).rows[0].body).toBe('hello');
        expect((await src.page(`${t}_v`, 0)).editable).toBe(false);
        await src.run(`DROP SCHEMA ${t}_s CASCADE; DROP VIEW ${t}_v`);
      }
    } finally {
      await src.run(`DROP TABLE IF EXISTS ${t}; DROP TABLE IF EXISTS ${t}_nokey`).catch(() => undefined);
      await src.close();
    }
  });
});
