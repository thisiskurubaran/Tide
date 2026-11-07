import type { RunnerMessage, RunRequest } from '@shared/protocol';

import type { Runner } from '../../../runtime/runner';
import { connectSql } from './client';
import { connectLines } from './lines';

// A runner whose program answers each request line with `answer`, in pieces.
function fakeRunner(answer: (req: any) => object) {
  let onMessage: (msg: RunnerMessage) => void = () => undefined;
  let req: RunRequest | null = null;
  const sent: string[] = [];
  const runner: Runner = {
    run(r, on) {
      req = r;
      onMessage = on;
      setTimeout(() => on({ type: 'stdout', id: r.id, data: '{"type":"ready","version":"Fake 1"}\n' }));
    },
    send(msg) {
      if (msg.type !== 'stdin') return;
      sent.push(msg.data);
      const body = JSON.parse(msg.data);
      if (body.op === 'close') return;
      const line = `${JSON.stringify({ ...answer(body), id: body.id })}\n`;
      // Split across two writes, as stdout may come.
      onMessage({ type: 'stdout', id: msg.id, data: line.slice(0, 5) });
      onMessage({ type: 'stdout', id: msg.id, data: line.slice(5) });
    },
  };
  return { runner, sent, request: () => req!, exit: (stderr: string) => (onMessage({ type: 'stderr', id: req!.id, data: stderr }), onMessage({ type: 'exit', id: req!.id, code: 1 })) };
}

it('runs a tide service with its settings and matches replies to requests', async () => {
  const fake = fakeRunner((b) => (b.fail ? { ok: false, error: 'nope' } : { ok: true, echo: b.x }));
  const lines = await connectLines(fake.runner, 'tide:redis', { TIDE_REDIS: '{}' });
  expect(lines.version).toBe('Fake 1');
  expect(fake.request()).toMatchObject({ runtime: 'node', entry: 'tide:redis', env: { TIDE_REDIS: '{}' }, limits: { timeoutMs: 0 } });
  await expect(lines.request({ x: 1 })).resolves.toMatchObject({ echo: 1 });
  await expect(lines.request({ fail: true })).rejects.toThrow('nope');
  await lines.close();
  expect(fake.sent[fake.sent.length - 1]).toBe('{"op":"close"}\n');
  await expect(lines.request({ x: 2 })).rejects.toThrow('closed');
});

it('fails waiting requests with what the program said when it exits', async () => {
  const fake = fakeRunner(() => ({ ok: true }));
  const lines = await connectLines(fake.runner, 'tide:mongo', {});
  fake.runner.send = () => undefined;
  const pending = lines.request({});
  fake.exit('Can’t find db.example.com.\n');
  await expect(pending).rejects.toThrow('Can’t find db.example.com.');
});

it('keeps connectSql’s queries as they were', async () => {
  const fake = fakeRunner((b) => ({ ok: true, columns: ['n'], rows: [[String(b.params[0])]], rowCount: 1, command: 'SELECT', hasRows: true, sql: b.sql }));
  const sql = await connectSql(fake.runner, { kind: 'postgres', host: 'h', port: 5432, user: 'u', ssl: 'off' });
  expect(sql.version).toBe('Fake 1');
  expect(JSON.parse(fake.request().env!.TIDE_SQL)).toMatchObject({ kind: 'postgres', host: 'h' });
  expect(await sql.query('SELECT $1', [7])).toMatchObject({ rows: [['7']], sql: 'SELECT $1' });
});
