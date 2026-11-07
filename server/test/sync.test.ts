// Unit tests that need no Docker: sync protocol handling, the watcher script
// run against a temp folder, and the WebSocket heartbeat.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import WebSocket from 'ws';

import type { SyncToApp } from '../../shared/protocol.ts';
import { createApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import type { Session, SessionManager } from '../src/sessions.ts';
import { attachSync } from '../src/sync.ts';
import { isSyncSkipped, SYNC_MAX_BYTES, SYNC_SKIP_DIRS } from '../src/syncRules.ts';

const WATCHER_PATH = fileURLToPath(new URL('../src/watcher.py', import.meta.url));
const b64 = (s: string) => Buffer.from(s).toString('base64');
const tick = () => new Promise((r) => setTimeout(r, 10));

test('watcher.py skips the same folders and size as the app', () => {
  const out = execFileSync('python3', [
    '-c',
    `import ast, json, sys
t = ast.parse(open(sys.argv[1]).read())
v = {}
for n in t.body:
    if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ("SKIP_DIRS", "MAX_BYTES"):
        v[n.targets[0].id] = eval(compile(ast.Expression(n.value), "w", "eval"))
print(json.dumps({"dirs": sorted(v["SKIP_DIRS"]), "max": v["MAX_BYTES"]}))`,
    WATCHER_PATH,
  ]);
  const { dirs, max } = JSON.parse(String(out));
  assert.deepEqual(dirs, [...SYNC_SKIP_DIRS].sort());
  assert.equal(max, SYNC_MAX_BYTES);
  assert.equal(isSyncSkipped('a/.next/cache/x.js'), true);
  assert.equal(isSyncSkipped('src/target.rs'), false);
  assert.equal(isSyncSkipped('dist/index.js'), false);
});

test('watcher reports oversize files and skips build folders', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-watch-'));
  try {
    fs.writeFileSync(path.join(root, 'small.txt'), 'x');
    fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(SYNC_MAX_BYTES + 1));
    const env = { ...process.env, TIDE_WATCH_ROOT: root };
    assert.deepEqual(JSON.parse(execFileSync('python3', [WATCHER_PATH, '--oversize'], { env }).toString()), ['big.bin']);

    const proc = spawn('python3', ['-u', WATCHER_PATH], { env });
    const lines: SyncToApp[] = [];
    readline.createInterface({ input: proc.stdout }).on('line', (l) => lines.push(JSON.parse(l)));
    try {
      await new Promise((r) => setTimeout(r, 300));
      fs.mkdirSync(path.join(root, '.next'));
      fs.writeFileSync(path.join(root, '.next', 'chunk.js'), 'built');
      fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(SYNC_MAX_BYTES + 2));
      fs.writeFileSync(path.join(root, 'small.txt'), 'changed');
      const end = Date.now() + 5000;
      while (!lines.some((m) => m.type === 'file') && Date.now() < end) await tick();
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      proc.kill();
    }
    const files = lines.filter((m) => m.type !== 'ports');
    assert.deepEqual(files.find((m) => m.type === 'skipped'), { type: 'skipped', path: 'big.bin' });
    assert.ok(files.some((m) => m.type === 'file' && m.path === 'small.txt'));
    assert.ok(!files.some((m) => 'path' in m && m.path.startsWith('.next')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: SyncToApp[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  receive(msg: object) {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }
}

function fakeSession(): Session {
  return { id: 's', project: 'p', previewKey: 'k', lastActive: 0, connections: 0, ports: [], skipped: new Set() } as unknown as Session;
}

function fakeManager(oversize: string[] = []) {
  const writes: string[][] = [];
  const watcherOut = new PassThrough();
  const manager = {
    output: async () => JSON.stringify(oversize),
    writeFiles: async (_s: Session, files: { path: string }[]) => void (files.length && writes.push(files.map((f) => f.path))),
    spawn: async () => ({ stdout: watcherOut, stop() {} }),
    run: async () => 0,
    touch() {},
  };
  return { manager: manager as unknown as SessionManager, writes, watcherOut };
}

const settle = async (ws: FakeWs, type: string) => {
  for (let i = 0; i < 100 && !ws.sent.some((m) => m.type === type); i++) await tick();
};

test('batched init answers ready only after the last batch', async () => {
  const { manager, writes } = fakeManager();
  const ws = new FakeWs();
  attachSync(manager, fakeSession(), ws as never, () => {});
  ws.receive({ type: 'init', files: [{ path: 'a.txt', data: b64('a') }], more: true });
  ws.receive({ type: 'init', files: [{ path: 'b.txt', data: b64('b') }, { path: 'target/debug/x', data: b64('x') }], more: true });
  await tick();
  assert.equal(ws.sent.length, 0);
  ws.receive({ type: 'init', files: [] });
  await settle(ws, 'ready');
  assert.deepEqual(ws.sent, [{ type: 'ready' }]);
  assert.deepEqual(writes, [['a.txt'], ['b.txt']]);
});

test('an oversize container file is not overwritten by init or later saves', async () => {
  const { manager, writes, watcherOut } = fakeManager(['big.log']);
  const session = fakeSession();
  const ws = new FakeWs();
  attachSync(manager, session, ws as never, () => {});
  ws.receive({ type: 'init', files: [{ path: 'big.log', data: b64('old') }, { path: 'a.txt', data: b64('a') }] });
  await settle(ws, 'ready');
  assert.deepEqual(writes, [['a.txt']]);
  assert.deepEqual(ws.sent, [{ type: 'skipped', path: 'big.log' }, { type: 'ready' }]);

  // The watcher reports another file grew past the limit: forwarded, and writes to it dropped.
  watcherOut.write(JSON.stringify({ type: 'skipped', path: 'a.txt' }) + '\n');
  await settle(ws, 'skipped');
  ws.sent.length = 0;
  ws.receive({ type: 'file', path: 'a.txt', data: b64('stale') });
  await tick();
  assert.deepEqual(writes, [['a.txt']]);
  assert.ok(session.skipped.has('a.txt'));

  // Once it shrinks the watcher sends it, and the app owns it again.
  watcherOut.write(JSON.stringify({ type: 'file', path: 'a.txt', data: b64('small') }) + '\n');
  await settle(ws, 'file');
  assert.equal(session.skipped.has('a.txt'), false);
  ws.receive({ type: 'file', path: 'a.txt', data: b64('edited') });
  for (let i = 0; i < 50 && writes.length < 2; i++) await tick();
  assert.deepEqual(writes, [['a.txt'], ['a.txt']]);
});

test('heartbeat terminates sockets that stop answering pings', async () => {
  const config = { token: 'test-token-0123456789' } as Config;
  const session = fakeSession();
  const { manager } = fakeManager();
  (manager as unknown as { get: () => Session }).get = () => session;
  const server = createApp(config, manager, { heartbeatMs: 50 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/sessions/s/sync`;
  const headers = { authorization: `Bearer ${config.token}` };
  try {
    const live = new WebSocket(url, { headers });
    const dead = new WebSocket(url, { headers, autoPong: false });
    await Promise.all([live, dead].map((ws) => new Promise((r) => ws.once('open', r))));
    assert.equal(session.connections, 2);
    await new Promise((r) => dead.once('close', r));
    await tick();
    assert.equal(session.connections, 1);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(live.readyState, WebSocket.OPEN);
    live.close();
    await new Promise((r) => live.once('close', r));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
