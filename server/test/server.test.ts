// Integration tests against the local Docker daemon. Build the image first:
// npm run image
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import WebSocket from 'ws';

import type { SessionInfo, SyncToApp } from '../../shared/protocol.ts';
import { createApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { connectDocker } from '../src/docker.ts';
import { SessionManager } from '../src/sessions.ts';

const TOKEN = 'test-token-0123456789';
const config: Config = {
  token: TOKEN,
  host: '127.0.0.1',
  port: 0,
  image: process.env.TIDE_IMAGE ?? 'tide-session:dev',
  idleMs: 60_000,
  memoryBytes: 512 * 1024 * 1024,
  cpus: 1,
  pids: 256,
};
const auth = { authorization: `Bearer ${TOKEN}` };
const docker = connectDocker();
const manager = new SessionManager(docker, config);
const server = createApp(config, manager);
let base = '';
const sockets: WebSocket[] = [];

before(async () => {
  await manager.start();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  // A failed test leaves its sockets open, which would keep the run alive.
  for (const ws of sockets) ws.terminate();
  server.closeAllConnections();
  server.close();
  await manager.stop();
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

async function open(project: string): Promise<SessionInfo> {
  const res = await fetch(`${base}/sessions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ project }) });
  assert.equal(res.status, 200);
  return (await res.json()) as SessionInfo;
}

function socket(id: string, kind: 'pty' | 'sync') {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/sessions/${id}/${kind}`, { headers: auth });
  sockets.push(ws);
  const messages: any[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const waitFor = async <T>(pick: () => T | undefined, ms = 15_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const found = pick();
      if (found) return found;
      if (Date.now() > end) throw new Error(`timed out; got ${JSON.stringify(messages).slice(-500)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { ws, messages, opened, waitFor, send: (m: object) => ws.send(JSON.stringify(m)) };
}

function shell(id: string) {
  const s = socket(id, 'pty');
  const output = () => s.messages.map((m) => m.data).join('');
  return {
    ...s,
    output,
    type: (line: string) => s.send({ type: 'pty', data: `${line}\r` }),
    until: (text: string, ms?: number) => s.waitFor(() => (output().includes(text) ? true : undefined), ms),
  };
}

test('rejects requests without the token', async () => {
  assert.equal((await fetch(`${base}/sessions`, { method: 'POST' })).status, 401);
  const ws = new WebSocket(`${base.replace('http', 'ws')}/sessions/nope/pty`, { headers: auth });
  await new Promise((r) => ws.once('error', r));
});

test('one container per project, with limits applied', async () => {
  const a = await open('limits');
  const again = await open('limits');
  assert.equal(again.id, a.id);
  const inspect = await docker.getContainer(`tide-${a.id}`).inspect();
  assert.equal(inspect.HostConfig.Memory, config.memoryBytes);
  assert.equal(inspect.HostConfig.PidsLimit, 256);
  assert.equal(inspect.HostConfig.Privileged, false);
  assert.deepEqual(inspect.HostConfig.CapDrop, ['ALL']);
  assert.equal(inspect.Config.User, 'tide');
  assert.deepEqual(inspect.HostConfig.PortBindings ?? {}, {});
  const res = await fetch(`${base}/sessions/${a.id}`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200);
  await assert.rejects(docker.getContainer(`tide-${a.id}`).inspect());
});

test('shell, sync both ways and preview', async () => {
  const session = await open('demo');
  const sync = socket(session.id, 'sync');
  await sync.opened;
  sync.send({ type: 'init', files: [{ path: 'index.js', data: b64('console.log(6*7)\n') }, { path: 'notes/a.txt', data: b64('from the phone\n') }] });
  await sync.waitFor(() => sync.messages.find((m: SyncToApp) => m.type === 'ready'));

  const sh = shell(session.id);
  await sh.opened;
  sh.type('cat notes/a.txt && node index.js && whoami');
  await sh.until('from the phone');
  await sh.until('42');
  await sh.until('tide');

  // Container -> app.
  sh.type('echo made in container > made.txt');
  const made = await sync.waitFor(() => sync.messages.find((m) => m.type === 'file' && m.path === 'made.txt'));
  assert.equal(Buffer.from(made.data, 'base64').toString(), 'made in container\n');

  // App -> container, without echoing the same content back.
  sync.send({ type: 'file', path: 'notes/a.txt', data: b64('edited on the phone\n') });
  sh.type('sleep 1.5; cat notes/a.txt');
  await sh.until('edited on the phone');
  assert.equal(sync.messages.filter((m) => m.type === 'file' && m.path === 'notes/a.txt').length, 0);

  // Deletes, both ways.
  sync.send({ type: 'delete', path: 'index.js' });
  sh.type('rm made.txt; ls');
  await sync.waitFor(() => sync.messages.find((m) => m.type === 'delete' && m.path === 'made.txt'));
  sh.type('test -e index.js || echo index-gone');
  await sh.until('index-gone');

  // Resize.
  sh.send({ type: 'resize', cols: 123, rows: 41 });
  sh.type('stty size');
  await sh.until('41 123');

  // Port detection and preview.
  sh.type('python3 -m http.server 8000 >/dev/null 2>&1 &');
  await sync.waitFor(() => sync.messages.find((m) => m.type === 'ports' && m.ports.includes(8000)));
  const redirect = await fetch(`${base}${session.previewBase}/8000`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const page = await fetch(`${base}${session.previewBase}/8000/notes/a.txt`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), 'edited on the phone\n');
  const closed = await fetch(`${base}${session.previewBase}/9999/`);
  assert.equal(closed.status, 502);
  assert.equal((await fetch(`${base}/p/wrong-key/8000/`)).status, 404);

  sh.ws.close();
  sync.ws.close();
});

test('closing a shell stops what it started', async () => {
  const session = await open('cleanup');
  const sh = shell(session.id);
  await sh.opened;
  sh.type('sleep 900 & node -e "setInterval(() => {}, 1000)"');
  const ps = async () => {
    const exec = await docker.getContainer(`tide-${session.id}`).exec({ Cmd: ['ps', '-eo', 'args'], AttachStdout: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    let out = '';
    stream.on('data', (d: Buffer) => (out += d.toString('latin1')));
    await new Promise((r) => stream.on('end', r));
    return out;
  };
  for (let i = 0; i < 50 && !(await ps()).includes('setInterval'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(await ps(), /sleep 900/);
  sh.ws.close();
  let left = '';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    left = await ps();
    if (!/sleep 900|setInterval|bash -l/.test(left)) break;
  }
  assert.doesNotMatch(left, /sleep 900|setInterval|bash -l/);
});
