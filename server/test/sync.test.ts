// Unit tests that need no Docker: sync protocol handling, the watcher script
// run against a temp folder, and the WebSocket heartbeat.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo, type Socket } from 'node:net';
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
import { handlePreview } from '../src/preview.ts';
import { streamDone, type Session, type SessionManager } from '../src/sessions.ts';
import { attachSync, hashBytes } from '../src/sync.ts';
import { isSyncSkipped, SYNC_MAX_BYTES, SYNC_PROTOCOL, SYNC_ROOT_SKIP_DIRS, SYNC_SKIP_DIRS } from '../src/syncRules.ts';
import { packTar, type TarFile } from '../src/tar.ts';

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
    if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ("SKIP_DIRS", "ROOT_SKIP_DIRS", "MAX_BYTES"):
        v[n.targets[0].id] = eval(compile(ast.Expression(n.value), "w", "eval"))
print(json.dumps({"dirs": sorted(v["SKIP_DIRS"]), "root": sorted(v["ROOT_SKIP_DIRS"]), "max": v["MAX_BYTES"]}))`,
    WATCHER_PATH,
  ]);
  const { dirs, root, max } = JSON.parse(String(out));
  assert.deepEqual(dirs, [...SYNC_SKIP_DIRS].sort());
  assert.deepEqual(root, [...SYNC_ROOT_SKIP_DIRS].sort());
  assert.equal(max, SYNC_MAX_BYTES);
  assert.equal(isSyncSkipped('a/.next/cache/x.js'), true);
  assert.equal(isSyncSkipped('src/target.rs'), false);
  assert.equal(isSyncSkipped('dist/index.js'), false);
});

test('generic build folder names are skipped only at the project root', () => {
  for (const p of ['coverage/lcov.info', 'target/debug/app', 'venv/bin/python', '.cache/x', 'pkg/node_modules/a/index.js', 'a/b/.git/HEAD', 'src/__pycache__/m.pyc']) {
    assert.equal(isSyncSkipped(p), true, p);
  }
  for (const p of ['src/features/coverage/Coverage.tsx', 'docs/target/goals.md', 'tools/venv/setup.md', 'src/.cache/keep.ts', 'coverage', 'target']) {
    assert.equal(isSyncSkipped(p), false, p);
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
  return { id: 's', project: 'p', previewKey: 'k', lastActive: 0, connections: 0, ports: [], skipped: new Set(), agreed: null, modes: new Map() } as unknown as Session;
}

// A container's /workspace in memory, behind the SessionManager calls sync makes.
// Each spawn starts a "watcher" whose snapshot is the files at that moment;
// tests report later container changes with watch().
function fakeContainer(initial: Record<string, string> = {}, opts: { owned?: string[]; modes?: Record<string, number> } = {}) {
  const files = new Map<string, Buffer>(Object.entries(initial).map(([p, c]) => [p, Buffer.from(c)]));
  const modes = new Map(Object.entries(opts.modes ?? {}));
  const owned = new Set(opts.owned ?? []);
  const writes: string[][] = [];
  const written: TarFile[] = [];
  const removed: string[] = [];
  const moved: [string, string][] = [];
  const runs: string[][] = [];
  let watcherOut = new PassThrough();
  const fileMsg = (p: string) => ({ type: 'file', path: p, data: files.get(p)!.toString('base64'), mode: modes.get(p) ?? 0o644 });
  const manager = {
    output: async (_s: Session, cmd: string[]) =>
      cmd
        .slice(cmd.indexOf('--read') + 1)
        .map((p) => JSON.stringify(owned.has(p) ? { type: 'skipped', path: p } : files.has(p) ? fileMsg(p) : { type: 'delete', path: p }))
        .join('\n'),
    writeFiles: async (_s: Session, list: TarFile[]) => {
      if (!list.length) return;
      writes.push(list.map((f) => f.path));
      for (const f of list) {
        files.set(f.path, f.data);
        written.push(f);
      }
    },
    spawn: async () => {
      watcherOut = new PassThrough();
      const snap = Object.fromEntries([...files].filter(([p]) => !owned.has(p)).map(([p, d]) => [p, [hashBytes(d), modes.get(p) ?? 0o644]]));
      watcherOut.write(JSON.stringify({ type: 'snapshot', files: snap, owned: [...owned] }) + '\n');
      return { stdout: watcherOut, stop() {} };
    },
    run: async (_s: Session, cmd: string[]) => {
      runs.push(cmd);
      if (cmd[0] === 'mv') {
        const [from, to] = cmd.slice(cmd.indexOf('--') + 1).map((p) => p.replace('/workspace/', ''));
        if (!files.has(from) && !owned.has(from)) return 1;
        if (files.has(from)) files.set(to, files.get(from)!);
        files.delete(from);
        moved.push([from, to]);
        return 0;
      }
      if (cmd[0] === 'rm') {
        for (const p of cmd.slice(cmd.indexOf('--') + 1)) {
          const rel = p.replace('/workspace/', '');
          files.delete(rel);
          removed.push(rel);
        }
      }
      return 0;
    },
    touch() {},
  };
  return {
    manager: manager as unknown as SessionManager,
    files,
    writes,
    written,
    removed,
    moved,
    runs,
    watch: (msg: object) => watcherOut.write(JSON.stringify(msg) + '\n'),
    text: (p: string) => files.get(p)?.toString(),
  };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await tick();
};
const settle = (ws: FakeWs, type: string) => until(() => ws.sent.some((m) => m.type === type));

async function connect(c: ReturnType<typeof fakeContainer>, session: Session, init: Record<string, string>, renameWindowMs?: number) {
  const ws = new FakeWs();
  attachSync(c.manager, session, ws as never, () => {}, { renameWindowMs });
  ws.receive({ type: 'init', files: Object.entries(init).map(([path, s]) => ({ path, data: b64(s) })) });
  await settle(ws, 'ready');
  return ws;
}

// The app's side of the acks: every file and delete it was sent, stored.
const ackAll = async (ws: FakeWs) => {
  for (const m of ws.sent) if (m.type === 'file' || m.type === 'delete') ws.receive({ type: 'ack', path: m.path, ok: true });
  await tick();
};

const decoded = (ws: FakeWs) => ws.sent.map((m) => (m.type === 'file' ? { ...m, data: Buffer.from(m.data, 'base64').toString() } : m));

test('batched init: each batch is acknowledged, ready only after the last', async () => {
  const c = fakeContainer();
  const ws = new FakeWs();
  attachSync(c.manager, fakeSession(), ws as never, () => {});
  ws.receive({ type: 'init', files: [{ path: 'a.txt', data: b64('a') }], more: true });
  await settle(ws, 'init-ack');
  assert.deepEqual(ws.sent, [{ type: 'init-ack' }]);
  ws.receive({ type: 'init', files: [{ path: 'b.txt', data: b64('b') }, { path: 'target/debug/x', data: b64('x') }], more: true });
  await until(() => ws.sent.length === 2);
  assert.deepEqual(ws.sent, [{ type: 'init-ack' }, { type: 'init-ack' }]);
  ws.receive({ type: 'init', files: [] });
  await settle(ws, 'ready');
  assert.deepEqual(ws.sent, [{ type: 'init-ack' }, { type: 'init-ack' }, { type: 'ready' }]);
  assert.deepEqual(c.writes, [['a.txt'], ['b.txt']]);
});

test('an oversize container file is not overwritten by init or later saves', async () => {
  const c = fakeContainer({}, { owned: ['big.log'] });
  const session = fakeSession();
  const ws = await connect(c, session, { 'big.log': 'old', 'a.txt': 'a' });
  assert.deepEqual(c.writes, [['a.txt']]);
  assert.deepEqual(ws.sent, [{ type: 'skipped', path: 'big.log' }, { type: 'ready' }]);

  // The watcher reports another file grew past the limit: forwarded, and writes to it dropped.
  c.watch({ type: 'skipped', path: 'a.txt' });
  await until(() => ws.sent.length === 3);
  ws.sent.length = 0;
  ws.receive({ type: 'file', path: 'a.txt', data: b64('stale') });
  await tick();
  assert.deepEqual(c.writes, [['a.txt']]);
  assert.ok(session.skipped.has('a.txt'));

  // Once it shrinks the watcher sends it, and the app owns it again.
  c.watch({ type: 'file', path: 'a.txt', data: b64('small') });
  await settle(ws, 'file');
  assert.equal(session.skipped.has('a.txt'), false);
  ws.receive({ type: 'file', path: 'a.txt', data: b64('edited') });
  await until(() => c.writes.length === 2);
  assert.deepEqual(c.writes, [['a.txt'], ['a.txt']]);
});

test('first init: the phone wins, unchanged files are not rewritten, container-only files are sent', async () => {
  const c = fakeContainer({ 'same.txt': 'same', 'diff.txt': 'container', 'only-here.txt': 'made in container' });
  const ws = await connect(c, fakeSession(), { 'same.txt': 'same', 'diff.txt': 'phone', 'new.txt': 'new' });
  assert.deepEqual(c.writes, [['diff.txt', 'new.txt']]);
  assert.equal(c.text('diff.txt'), 'phone');
  assert.deepEqual(decoded(ws), [{ type: 'file', path: 'only-here.txt', data: 'made in container' }, { type: 'ready' }]);
});

test('reconnect reconciles three ways against the last agreed content', async () => {
  const c = fakeContainer();
  const session = fakeSession();
  const start = { 'same.txt': 's', 'phone.txt': 'p0', 'cont.txt': 'c0', 'both.txt': 'b0', 'gone-phone.txt': 'g0', 'gone-cont.txt': 'x0' };
  const ws1 = await connect(c, session, start);
  ws1.close();

  // While disconnected, the container...
  c.files.set('cont.txt', Buffer.from('c1'));
  c.files.set('both.txt', Buffer.from('b-container'));
  c.files.delete('gone-cont.txt');
  c.files.set('new-cont.txt', Buffer.from('n'));
  // ...and the phone (phone.txt and both.txt edited, gone-phone.txt deleted) changed things.
  c.writes.length = 0;
  const ws2 = await connect(c, session, { 'same.txt': 's', 'phone.txt': 'p1', 'cont.txt': 'c0', 'both.txt': 'b-phone', 'gone-cont.txt': 'x0' });

  // Conflict copies are named and written after the last init batch.
  assert.deepEqual(c.writes, [['phone.txt'], ['both.txt.phone-conflict']]);
  assert.deepEqual(c.removed, ['gone-phone.txt']);
  assert.deepEqual(Object.fromEntries([...c.files].map(([p, d]) => [p, d.toString()])), {
    'same.txt': 's',
    'phone.txt': 'p1',
    'cont.txt': 'c1',
    'both.txt': 'b-container',
    'both.txt.phone-conflict': 'b-phone',
    'new-cont.txt': 'n',
  });
  assert.deepEqual(decoded(ws2), [
    { type: 'file', path: 'both.txt.phone-conflict', data: 'b-phone' },
    { type: 'file', path: 'cont.txt', data: 'c1' },
    { type: 'file', path: 'both.txt', data: 'b-container' },
    { type: 'file', path: 'new-cont.txt', data: 'n' },
    { type: 'delete', path: 'gone-cont.txt' },
    { type: 'ready' },
  ]);

  // Once the app has acknowledged them, both sides agree: the next init changes nothing.
  await ackAll(ws2);
  ws2.close();
  c.writes.length = 0;
  c.removed.length = 0;
  const ws3 = await connect(c, session, Object.fromEntries([...c.files].map(([p, d]) => [p, d.toString()])));
  assert.deepEqual(ws3.sent, [{ type: 'ready' }]);
  assert.deepEqual(c.writes, []);
  assert.deepEqual(c.removed, []);
});

test('a conflict copy never lands on a path the phone sends later in the init', async () => {
  const c = fakeContainer();
  const session = fakeSession();
  const ws1 = await connect(c, session, { 'x.txt': 'x0' });
  await ackAll(ws1);
  ws1.close();

  // The phone has x.txt.phone-conflict (unsent, or deleted in the container) and both sides edit x.txt.
  c.files.set('x.txt', Buffer.from('x-container'));
  const ws2 = new FakeWs();
  attachSync(c.manager, session, ws2 as never, () => {});
  ws2.receive({ type: 'init', files: [{ path: 'x.txt', data: b64('x-phone') }], more: true });
  await settle(ws2, 'init-ack');
  ws2.receive({ type: 'init', files: [{ path: 'x.txt.phone-conflict', data: b64('older copy') }] });
  await settle(ws2, 'ready');

  assert.equal(c.text('x.txt'), 'x-container');
  assert.equal(c.text('x.txt.phone-conflict'), 'older copy');
  assert.equal(c.text('x.txt.phone-conflict-2'), 'x-phone');
  assert.deepEqual(decoded(ws2), [
    { type: 'init-ack' },
    { type: 'file', path: 'x.txt.phone-conflict-2', data: 'x-phone' },
    { type: 'file', path: 'x.txt', data: 'x-container' },
    { type: 'ready' },
  ]);

  // Next reconnect: nothing is lost, nothing changes.
  await ackAll(ws2);
  ws2.close();
  c.writes.length = 0;
  c.removed.length = 0;
  const ws3 = await connect(c, session, { 'x.txt': 'x-container', 'x.txt.phone-conflict': 'older copy', 'x.txt.phone-conflict-2': 'x-phone' });
  assert.deepEqual(ws3.sent, [{ type: 'ready' }]);
  assert.deepEqual(c.writes, []);
  assert.deepEqual(c.removed, []);
});

test('a conflict copy avoids phone files the app could not send', async () => {
  const c = fakeContainer();
  const session = fakeSession();
  const ws1 = await connect(c, session, { 'x.txt': 'x0' });
  await ackAll(ws1);
  ws1.close();
  c.files.set('x.txt', Buffer.from('x-container'));
  const ws2 = new FakeWs();
  attachSync(c.manager, session, ws2 as never, () => {});
  ws2.receive({ type: 'init', files: [{ path: 'x.txt', data: b64('x-phone') }], skippedPaths: ['x.txt.phone-conflict'] });
  await settle(ws2, 'ready');
  assert.equal(c.text('x.txt.phone-conflict'), undefined);
  assert.equal(c.text('x.txt.phone-conflict-2'), 'x-phone');
});

test('phone files too big to send are never deleted or overwritten', async () => {
  const c = fakeContainer();
  const session = fakeSession();
  const ws1 = await connect(c, session, { 'big.bin': 'small once', 'a.txt': 'a' });
  await ackAll(ws1);
  ws1.close();

  // The phone's big.bin grew past the limit; the container's copy is unchanged. A
  // container-only file the phone also has but can't send isn't sent over it.
  c.files.set('other.bin', Buffer.from('container copy'));
  const ws2 = new FakeWs();
  attachSync(c.manager, session, ws2 as never, () => {});
  ws2.receive({ type: 'init', files: [{ path: 'a.txt', data: b64('a') }], skippedPaths: ['big.bin', 'other.bin', '../escape'] });
  await settle(ws2, 'ready');
  assert.deepEqual(c.removed, []);
  assert.equal(c.text('big.bin'), 'small once');
  assert.equal(c.text('other.bin'), 'container copy');
  assert.deepEqual(ws2.sent, [{ type: 'ready' }]);

  // Without skippedPaths (an older app) its absence is still a phone-side delete.
  ws2.close();
  await connect(c, session, { 'a.txt': 'a' });
  assert.deepEqual(c.removed, ['big.bin']);
});

test('a container file the app did not store is never deleted from the container', async () => {
  const c = fakeContainer({ 'bad:name.txt': 'x', 'ok.txt': 'y' });
  const session = fakeSession();
  const ws1 = await connect(c, session, {});
  assert.deepEqual(
    ws1.sent.map((m) => m.type),
    ['file', 'file', 'ready'],
  );
  ws1.receive({ type: 'ack', path: 'bad:name.txt', ok: false });
  ws1.receive({ type: 'ack', path: 'ok.txt', ok: true });
  await tick();
  ws1.close();

  // The phone deleted ok.txt while offline; it never had bad:name.txt, so its absence is not a delete.
  const ws2 = await connect(c, session, {});
  assert.deepEqual(c.removed, ['ok.txt']);
  assert.equal(c.text('bad:name.txt'), 'x');
  assert.deepEqual(decoded(ws2), [{ type: 'file', path: 'bad:name.txt', data: 'x' }, { type: 'ready' }]);

  // Sent but never acknowledged (the socket dropped): not taken as deleted either.
  ws2.close();
  const ws3 = await connect(c, session, {});
  assert.deepEqual(c.removed, ['ok.txt']);
  assert.equal(ws3.sent[0].type, 'file');
});

test('writes keep the container file mode and never touch symlinks', async () => {
  const c = fakeContainer({ gradlew: '#!/bin/sh\n' }, { modes: { gradlew: 0o755 }, owned: ['link.txt', 'vendor'] });
  const ws = await connect(c, fakeSession(), { gradlew: '#!/bin/sh\n', 'link.txt': 'phone copy', 'vendor/lib.js': 'x' });
  // Unchanged gradlew isn't rewritten; the symlink and the symlinked folder aren't written at all.
  assert.deepEqual(c.writes, []);
  assert.deepEqual(ws.sent, [{ type: 'skipped', path: 'link.txt' }, { type: 'skipped', path: 'vendor/lib.js' }, { type: 'ready' }]);

  ws.receive({ type: 'file', path: 'gradlew', data: b64('#!/bin/sh\necho hi\n') });
  ws.receive({ type: 'file', path: 'new.sh', data: b64('x') });
  ws.receive({ type: 'delete', path: 'vendor/lib.js' });
  ws.receive({ type: 'file', path: 'vendor/lib.js', data: b64('y') });
  await until(() => c.writes.length === 2);
  await tick();
  assert.deepEqual(
    c.written.map((f) => [f.path, f.mode]),
    [
      ['gradlew', 0o755],
      ['new.sh', undefined],
    ],
  );
  assert.deepEqual(c.removed, []);

  // A chmod in the container is kept by later writes, and its report isn't echoed to the app.
  ws.sent.length = 0;
  c.watch({ type: 'file', path: 'new.sh', data: b64('x'), mode: 0o755 });
  await tick();
  ws.receive({ type: 'file', path: 'new.sh', data: b64('z') });
  await until(() => c.writes.length === 3);
  assert.equal(c.written.at(-1)!.mode, 0o755);
  assert.deepEqual(ws.sent, []);
});

// The app only sends a delete for a container-owned path when it became owned
// after the app last looked (here: a.txt grew past the limit in the container).
async function ownedAfterAgreeing(c: ReturnType<typeof fakeContainer>, session: Session, renameWindowMs: number) {
  const ws = await connect(c, session, { 'a.txt': 'small', 'dir/b.txt': 'b' }, renameWindowMs);
  c.files.set('a.txt', Buffer.from('BIG'));
  c.watch({ type: 'skipped', path: 'a.txt' });
  await settle(ws, 'skipped');
  ws.sent.length = 0;
  return ws;
}

test('an app delete of a container-owned file deletes it in the container', async () => {
  const c = fakeContainer();
  const session = fakeSession();
  const ws = await ownedAfterAgreeing(c, session, 30);
  ws.receive({ type: 'delete', path: 'a.txt' });
  await tick();
  assert.deepEqual(c.removed, []); // Waits in case a rename's 'file' follows.
  await until(() => c.removed.length > 0);
  assert.deepEqual(c.removed, ['a.txt']);
  assert.equal(session.skipped.has('a.txt'), false);
  assert.equal(session.agreed!.has('a.txt'), false);
  // The watcher's report of it is not echoed to the app, which already deleted it.
  c.watch({ type: 'delete', path: 'a.txt' });
  await tick();
  assert.deepEqual(ws.sent, []);
});

test('an app rename of a container-owned file moves the container copy and hands the new path to the container', async () => {
  const c = fakeContainer();
  const session = fakeSession();
  const ws = await ownedAfterAgreeing(c, session, 1000);
  // A rename in the app's tree: the old path deleted, the new one holding what the app had.
  ws.receive({ type: 'delete', path: 'a.txt' });
  ws.receive({ type: 'file', path: 'moved/a.txt', data: b64('small') });
  await settle(ws, 'skipped');
  assert.deepEqual(c.moved, [['a.txt', 'moved/a.txt']]);
  assert.equal(c.text('moved/a.txt'), 'BIG'); // Not overwritten by the app's stale copy.
  assert.ok(c.runs.some((r) => r[0] === 'mkdir' && r.at(-1) === '/workspace/moved'));
  assert.deepEqual(ws.sent, [{ type: 'skipped', path: 'moved/a.txt' }]);
  assert.ok(session.skipped.has('moved/a.txt'));
  assert.equal(session.skipped.has('a.txt'), false);
  // Later app writes to the new path are dropped like any container-owned path.
  ws.receive({ type: 'file', path: 'moved/a.txt', data: b64('stale edit') });
  await tick();
  assert.equal(c.text('moved/a.txt'), 'BIG');
  // Nothing is left to delete when the socket closes.
  ws.close();
  await tick();
  assert.deepEqual(c.removed, []);
});

test('a pending owned delete runs when the socket closes; deletes inside a symlinked folder never do', async () => {
  const c = fakeContainer({}, { owned: ['vendor'] });
  const session = fakeSession();
  const ws = await ownedAfterAgreeing(c, session, 60_000);
  ws.receive({ type: 'delete', path: 'vendor/lib.js' });
  ws.receive({ type: 'delete', path: 'a.txt' });
  await tick();
  assert.deepEqual(ws.sent, [{ type: 'skipped', path: 'vendor/lib.js' }]);
  assert.deepEqual(c.removed, []);
  ws.close();
  await until(() => c.removed.length > 0);
  assert.deepEqual(c.removed, ['a.txt']);
});

test('packTar writes each file with its mode', () => {
  const tar = packTar([
    { path: 'bin/run', data: Buffer.from('x'), mode: 0o755 },
    { path: 'a.txt', data: Buffer.from('y') },
  ]);
  const listing = execFileSync('tar', ['-tvf', '-'], { input: tar }).toString();
  assert.match(listing, /^-rwxr-xr-x .*bin\/run$/m);
  assert.match(listing, /^-rw-r--r-- .*a\.txt$/m);
});

test('a stale watcher read between two quick saves never reaches the app', async () => {
  const c = fakeContainer();
  const ws = await connect(c, fakeSession(), {});
  ws.sent.length = 0;
  ws.receive({ type: 'file', path: 'a.txt', data: b64('v1') });
  ws.receive({ type: 'file', path: 'a.txt', data: b64('v2') });
  await until(() => c.writes.length === 2);
  // The watcher read the file between the two writes, then saw the second.
  c.watch({ type: 'file', path: 'a.txt', data: b64('v1') });
  c.watch({ type: 'file', path: 'a.txt', data: b64('v2') });
  await tick();
  assert.deepEqual(ws.sent, []);

  // Real container edits still reach the app, even back to an earlier content.
  c.watch({ type: 'file', path: 'a.txt', data: b64('v3') });
  c.watch({ type: 'file', path: 'a.txt', data: b64('v1') });
  await until(() => ws.sent.length === 2);
  assert.deepEqual(decoded(ws), [
    { type: 'file', path: 'a.txt', data: 'v3' },
    { type: 'file', path: 'a.txt', data: 'v1' },
  ]);
});

test('container changes during the init are not lost or overwritten', async () => {
  const c = fakeContainer({ 'a.txt': 'a0' });
  const session = fakeSession();
  (await connect(c, session, { 'a.txt': 'a0' })).close();
  const writesBefore = c.writes.length;

  const ws = new FakeWs();
  attachSync(c.manager, session, ws as never, () => {});
  ws.receive({ type: 'init', files: [], more: true });
  await settle(ws, 'init-ack');
  // Edited in the container after the snapshot, before the app's batch with it arrives.
  c.files.set('a.txt', Buffer.from('a-container'));
  c.watch({ type: 'file', path: 'a.txt', data: b64('a-container') });
  c.files.set('late.txt', Buffer.from('late'));
  c.watch({ type: 'file', path: 'late.txt', data: b64('late') });
  await tick();
  assert.deepEqual(ws.sent, [{ type: 'init-ack' }]);
  ws.receive({ type: 'init', files: [{ path: 'a.txt', data: b64('a0') }] });
  await settle(ws, 'ready');
  assert.deepEqual(c.writes.slice(writesBefore), []);
  assert.equal(c.text('a.txt'), 'a-container');
  assert.deepEqual(decoded(ws).slice(1), [
    { type: 'file', path: 'a.txt', data: 'a-container' },
    { type: 'file', path: 'late.txt', data: 'late' },
    { type: 'ready' },
  ]);
});

test('watcher: snapshot, symlinks, modes, and same-size saves within one second', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-watch-'));
  const at = (p: string) => path.join(root, p);
  try {
    // Whole-second mtimes, as tar writes them.
    const SECOND = 1_700_000_000;
    fs.writeFileSync(at('a.txt'), 'v1');
    fs.utimesSync(at('a.txt'), SECOND, SECOND);
    fs.writeFileSync(at('run.sh'), '#!/bin/sh\n');
    fs.chmodSync(at('run.sh'), 0o755);
    fs.writeFileSync(at('big.bin'), Buffer.alloc(SYNC_MAX_BYTES + 1));
    fs.symlinkSync('a.txt', at('link.txt'));
    fs.mkdirSync(at('real'));
    fs.writeFileSync(at('real/x'), 'x');
    fs.symlinkSync('real', at('linkdir'));
    fs.mkdirSync(at('.next'));
    fs.writeFileSync(at('.next/chunk.js'), 'built');
    // Generic names: skipped as top-level folders, synced deeper down.
    fs.mkdirSync(at('coverage'));
    fs.writeFileSync(at('coverage/lcov.info'), 'report');
    fs.mkdirSync(at('src/features/coverage'), { recursive: true });
    fs.writeFileSync(at('src/features/coverage/index.ts'), 'source');
    fs.mkdirSync(at('src/node_modules'));
    fs.writeFileSync(at('src/node_modules/dep.js'), 'dep');
    const env = { ...process.env, TIDE_WATCH_ROOT: root };

    const proc = spawn('python3', ['-u', WATCHER_PATH], { env });
    const lines: any[] = [];
    readline.createInterface({ input: proc.stdout }).on('line', (l) => lines.push(JSON.parse(l)));
    const waitFor = async (pick: (m: any) => boolean) => {
      const end = Date.now() + 5000;
      while (!lines.some(pick) && Date.now() < end) await tick();
      return lines.find(pick);
    };
    try {
      const snap = await waitFor((m) => m.type === 'snapshot');
      assert.deepEqual(Object.keys(snap.files).sort(), ['a.txt', 'real/x', 'run.sh', 'src/features/coverage/index.ts']);
      assert.equal(snap.files['a.txt'][0], crypto.createHash('sha1').update('v1').digest('hex'));
      assert.equal(snap.files['run.sh'][1], 0o755);
      assert.deepEqual(snap.owned, ['big.bin', 'link.txt', 'linkdir']);

      // Same size, same whole-second mtime: only ctime tells them apart.
      fs.writeFileSync(at('a.txt'), 'v2');
      fs.utimesSync(at('a.txt'), SECOND, SECOND);
      const v2 = await waitFor((m) => m.type === 'file' && m.path === 'a.txt');
      assert.equal(Buffer.from(v2.data, 'base64').toString(), 'v2');

      fs.chmodSync(at('a.txt'), 0o755);
      assert.ok(await waitFor((m) => m.type === 'file' && m.path === 'a.txt' && m.mode === 0o755));
      fs.symlinkSync('run.sh', at('new-link'));
      assert.ok(await waitFor((m) => m.type === 'skipped' && m.path === 'new-link'));
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      proc.kill();
    }
    assert.ok(!lines.some((m) => m.type === 'file' && /^(link|\.next|linkdir|new-link)/.test(m.path)));

    const read = execFileSync('python3', [WATCHER_PATH, '--read', 'a.txt', 'link.txt', 'missing.txt'], { env })
      .toString()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.deepEqual(read, [
      { type: 'file', path: 'a.txt', data: b64('v2'), mode: 0o755 },
      { type: 'skipped', path: 'link.txt' },
      { type: 'delete', path: 'missing.txt' },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function heartbeatServer() {
  const config = { token: 'test-token-0123456789' } as Config;
  const session = fakeSession();
  const { manager } = fakeContainer();
  (manager as unknown as { get: () => Session }).get = () => session;
  const server = createApp(config, manager, { heartbeatMs: 50 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/sessions/s/sync`;
  const headers = { authorization: `Bearer ${config.token}` };
  const stop = () => {
    server.closeAllConnections();
    server.close();
  };
  return { session, url, headers, stop };
}

test('heartbeat terminates sockets that stop answering pings', async () => {
  const { session, url, headers, stop } = await heartbeatServer();
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
    stop();
  }
});

test('heartbeat keeps a socket whose upload is still arriving, without pongs', async () => {
  const { url, headers, stop } = await heartbeatServer();
  try {
    // Never answers pings, like a client whose pongs are queued behind its upload.
    const slow = new WebSocket(url, { headers, autoPong: false });
    await new Promise((r) => slow.once('open', r));
    let closed = false;
    slow.once('close', () => (closed = true));
    // One text frame trickling in a byte at a time over 8 heartbeat intervals
    // (masked with a zero key, as a client must mask).
    const raw = (slow as unknown as { _socket: Socket })._socket;
    const len = 40;
    raw.write(Buffer.from([0x81, 0x80 | len, 0, 0, 0, 0]));
    for (let i = 0; i < len; i++) {
      await new Promise((r) => setTimeout(r, 10));
      raw.write(Buffer.from(' '));
    }
    assert.equal(closed, false);
    // Then silence: terminated.
    await until(() => closed);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(closed, true);
  } finally {
    stop();
  }
});

test('exec waits settle on error, on close and on timeout, not only on end', async () => {
  const errored = new PassThrough();
  const p1 = streamDone(errored, 5000);
  errored.destroy(new Error('docker stream broke'));
  await assert.rejects(p1, /docker stream broke/);

  const closed = new PassThrough();
  const p2 = streamDone(closed, 5000);
  closed.destroy();
  await p2;

  const ended = new PassThrough();
  const p3 = streamDone(ended, 5000);
  ended.resume();
  ended.end();
  await p3;

  const stuck = new PassThrough();
  await assert.rejects(streamDone(stuck, 20), /timed out/);
  assert.equal(stuck.destroyed, true);
});

test('preview: the upstream relay is torn down when the browser goes away', async () => {
  // A dev server streaming forever (an event stream) inside the "container".
  let upstreamClosed = false;
  const dev = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: hello\n\n');
    res.on('close', () => (upstreamClosed = true));
  });
  await new Promise<void>((r) => dev.listen(0, '127.0.0.1', () => r()));
  const devPort = (dev.address() as AddressInfo).port;
  let relayDestroyed = false;
  const session = fakeSession();
  const manager = {
    byPreviewKey: (k: string) => (k === 'key' ? session : undefined),
    touch() {},
    // Stands in for the relay exec: destroying it is what kills the exec.
    connect: async () => {
      const sock = net.connect(devPort, '127.0.0.1');
      const destroy = sock.destroy.bind(sock);
      sock.destroy = (e?: Error) => {
        relayDestroyed = true;
        return destroy(e);
      };
      await new Promise((r) => sock.once('connect', r));
      return sock;
    },
  } as unknown as SessionManager;
  const proxy = http.createServer((req, res) => {
    if (!handlePreview(manager, req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
  try {
    const req = http.get(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}/p/key/3000/events`);
    const res = await new Promise<http.IncomingMessage>((r) => req.once('response', r));
    assert.equal(res.statusCode, 200);
    await new Promise((r) => res.once('data', r));
    assert.equal(relayDestroyed, false);
    req.on('error', () => undefined);
    req.destroy();
    await until(() => relayDestroyed && upstreamClosed);
    assert.equal(relayDestroyed, true);
    assert.equal(upstreamClosed, true);
  } finally {
    proxy.closeAllConnections();
    proxy.close();
    dev.closeAllConnections();
    dev.close();
  }
});

test('the server reports its sync protocol on /health and with each session', async () => {
  const config = { token: 'test-token-0123456789' } as Config;
  const session = fakeSession();
  const { manager } = fakeContainer();
  (manager as unknown as { get: () => Session }).get = () => session;
  const server = createApp(config, manager);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, protocol: SYNC_PROTOCOL });
    const info = await (await fetch(`${base}/sessions/${session.id}`, { headers: { authorization: `Bearer ${config.token}` } })).json();
    assert.equal(info.protocol, SYNC_PROTOCOL);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
