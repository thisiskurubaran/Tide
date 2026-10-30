/**
 * @jest-environment node
 */
import { DatabaseSync } from 'node:sqlite';

import type { Db } from '../../database/database';
import { createMemoryFs } from '../../files/memoryFs';
import { createWorkspace } from '../../files/workspace';
import type { Runner } from '../../../runtime/runner';
import { createBuffersStore } from '../../../state/buffers';
import { createProjectsStore } from '../../../state/projects';
import { createFsStorage } from '../../../state/storage';
import { createTabsStore } from '../../../state/tabs';
import { Shell } from './shell';
import { createShellFs } from './shellFs';
import { formatResult, isComplete } from './sqlite';

// expo-sqlite's async API over Node's built-in SQLite, one database per path.
function nodeDb(db: DatabaseSync): Db {
  const rows = (sql: string, params: unknown[]) => db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
  return {
    getAllAsync: async <T,>(sql: string, ...params: unknown[]) => rows(sql, params) as T[],
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    execAsync: async (sql: string) => db.exec(sql),
    closeAsync: async () => undefined,
  };
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const tick = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(() => r()));
};

async function setup() {
  const memfs = createMemoryFs();
  const workspace = createWorkspace(memfs);
  await workspace.createProject('demo', 'node-hello');
  const tabs = createTabsStore(createFsStorage(memfs));
  const buffers = createBuffersStore(workspace);
  const projects = createProjectsStore(workspace, tabs, buffers);
  const databases = new Map<string, DatabaseSync>();
  const opened: string[] = [];
  let output = '';
  const shell = new Shell({
    project: 'demo',
    fs: createShellFs('demo', workspace, projects, buffers),
    runner: { run() {}, send() {} } as Runner,
    write: (d) => (output += d),
    projectRoot: 'projects/demo',
    sqlite: {
      open: async (path) => {
        opened.push(path);
        if (!databases.has(path)) databases.set(path, new DatabaseSync(':memory:'));
        return nodeDb(databases.get(path)!);
      },
    },
  });
  shell.start();
  await tick();
  const run = async (line: string) => {
    output = '';
    shell.input(`${line}\r`);
    await tick();
    return strip(output);
  };
  return { shell, run, opened, out: () => strip(output) };
}

describe('sqlite3 in the shell', () => {
  it('runs one statement and prints a table', async () => {
    const { run, opened } = await setup();
    await run('sqlite3 app.db "CREATE TABLE people(name TEXT, age INT); INSERT INTO people VALUES (\'Ada\', 36), (\'Alan\', NULL);"');
    const out = await run('sqlite3 app.db "SELECT name, age FROM people ORDER BY name"');
    expect(out).toContain('│ name │ age  │');
    expect(out).toContain('│ Ada  │ 36   │');
    expect(out).toContain('│ Alan │ NULL │');
    expect(opened).toEqual(['app.db', 'app.db']);
  });

  it('opens a sqlite> prompt with multi-line statements and dot commands', async () => {
    const { run, shell, out } = await setup();
    let text = await run('sqlite3 notes.db');
    expect(text).toContain('sqlite> ');
    text = await run('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT);');
    text = await run("INSERT INTO notes(body) VALUES ('first'),");
    expect(text).toContain('...> ');
    text = await run("('second');");
    expect(text).toContain('2 rows changed');
    text = await run('.tables');
    expect(text).toContain('notes');
    text = await run('.mode csv');
    text = await run('SELECT * FROM notes;');
    expect(text).toContain('id,body\n1,first\n2,second');
    text = await run('SELEC oops;');
    expect(text).toContain('Error:');
    text = await run('.quit');
    expect(text).toContain('demo / $ ');
    shell.input('pwd\r');
    await tick();
    expect(out()).toContain('/');
  });

  it('knows when a statement is complete', () => {
    expect(isComplete("SELECT ';' FROM t")).toBe(false);
    expect(isComplete('SELECT 1; -- done')).toBe(true);
    expect(formatResult({ kind: 'changes', changes: 1 }, { headers: true, mode: 'table' })).toBe('1 row changed\n');
  });
});
