import type { SyncToApp, SyncToServer } from '@shared/protocol';

import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { checkProtocol, openSession, previewUrl, RemoteError, socketUrl } from './api';
import { RemotePty } from './pty';
import { isInsecureUrl, normalizeUrl, validateSettings } from './settings';
import { base64Bytes, INIT_BATCH_BYTES, MAX_SYNC_BYTES, RemoteSync } from './sync';
import { isSyncSkipped, SYNC_ROOT_SKIP_DIRS, SYNC_SKIP_DIRS } from './syncRules';

class FakeSocket {
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { reason: string }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: SyncToApp | object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const b64 = (s: string) => Buffer.from(s).toString('base64');
const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(prepare?: (workspace: ReturnType<typeof createWorkspace>) => Promise<void>) {
  const fs = createMemoryFs();
  const workspace = createWorkspace(fs);
  await workspace.createProject('demo', 'node-hello');
  await workspace.createFolder('demo', '', 'node_modules');
  await workspace.createFile('demo', 'node_modules', 'skip.js', 'x');
  await prepare?.(workspace);
  const socket = new FakeSocket();
  const hooks = { onFileChanged: jest.fn(), onTreeChanged: jest.fn(), onPorts: jest.fn(), onReady: jest.fn() };
  const sync = new RemoteSync(socket as unknown as WebSocket, 'demo', workspace, hooks);
  socket.open();
  await flush();
  return { fs, workspace, socket, hooks, sync };
}

const sent = (socket: FakeSocket) => socket.sent as SyncToServer[];
// What the phone sent apart from its acks of container changes.
const changes = (socket: FakeSocket) => sent(socket).filter((m) => m.type !== 'ack');

describe('RemoteSync', () => {
  it('sends the project on connect, without node_modules', async () => {
    const { socket, workspace } = await setup();
    const init = sent(socket)[0];
    expect(init.type).toBe('init');
    const paths = init.type === 'init' ? init.files.map((f) => f.path).sort() : [];
    expect(paths).toEqual((await workspace.listFiles('demo')).sort());
    expect(paths).not.toContain('node_modules/skip.js');
  });

  it('applies container changes and does not send them back', async () => {
    const { socket, workspace, hooks, sync } = await setup();
    socket.receive({ type: 'ready' });
    socket.receive({ type: 'file', path: 'made.txt', data: b64('hi\n') });
    await flush();
    expect(await workspace.readFile('demo', 'made.txt')).toBe('hi\n');
    expect(hooks.onFileChanged).toHaveBeenCalledWith('made.txt');
    expect(hooks.onTreeChanged).toHaveBeenCalled();

    socket.sent.length = 0;
    sync.changed([]);
    await flush();
    expect(changes(socket)).toEqual([]);

    socket.receive({ type: 'delete', path: 'made.txt' });
    await flush();
    expect(await workspace.stat('demo', 'made.txt')).toBeNull();
    expect(changes(socket)).toEqual([]);
  });

  it('sends saves, new files and deletes from the phone', async () => {
    const { socket, workspace, sync } = await setup();
    socket.receive({ type: 'ready' });
    await flush();
    socket.sent.length = 0;

    await workspace.writeFile('demo', 'index.js', 'console.log(1)\n');
    sync.changed(['index.js']);
    await flush();
    expect(socket.sent).toEqual([{ type: 'file', path: 'index.js', data: b64('console.log(1)\n') }]);

    socket.sent.length = 0;
    await workspace.createFile('demo', '', 'new.py', 'print(2)\n');
    await workspace.deleteEntry('demo', 'index.js');
    sync.changed([]);
    await flush();
    expect(socket.sent).toEqual([
      { type: 'delete', path: 'index.js' },
      { type: 'file', path: 'new.py', data: b64('print(2)\n') },
    ]);
  });

  it('sends changes made before the first sync is done once it is', async () => {
    const { socket, workspace, sync } = await setup();
    socket.sent.length = 0;
    await workspace.writeFile('demo', 'index.js', 'edited during init');
    sync.changed(['index.js']);
    await workspace.createFile('demo', '', 'late.txt', 'late');
    sync.changed([]);
    await flush();
    expect(socket.sent).toEqual([]);
    socket.receive({ type: 'ready' });
    await flush();
    expect(socket.sent).toEqual([
      { type: 'file', path: 'index.js', data: b64('edited during init') },
      { type: 'file', path: 'late.txt', data: b64('late') },
    ]);
  });

  it('keeps an edit saved during the init when the container version arrives before ready', async () => {
    const { socket, workspace, sync } = await setup();
    await workspace.writeFile('demo', 'index.js', 'saved during init');
    sync.changed(['index.js']);
    socket.receive({ type: 'file', path: 'index.js', data: b64('container won') });
    await flush();
    expect(await workspace.readFile('demo', 'index.js')).toBe('container won');
    expect(await workspace.readFile('demo', 'index.js.phone-conflict')).toBe('saved during init');
    socket.sent.length = 0;
    socket.receive({ type: 'ready' });
    await flush();
    expect(changes(socket)).toEqual([{ type: 'file', path: 'index.js.phone-conflict', data: b64('saved during init') }]);
  });

  it('skips build and cache folders', async () => {
    const { socket } = await setup(async (workspace) => {
      await workspace.createFolder('demo', '', '.next');
      await workspace.createFile('demo', '.next', 'chunk.js', 'built');
      await workspace.createFolder('demo', '', 'src');
      await workspace.createFolder('demo', 'src', 'target');
      await workspace.createFile('demo', 'src/target', 'out.o', 'o');
      await workspace.createFile('demo', 'src', 'target.rs', 'fn main() {}');
    });
    const init = sent(socket)[0];
    const paths = init.type === 'init' ? init.files.map((f) => f.path) : [];
    expect(paths).toContain('src/target.rs');
    expect(paths.filter(isSyncSkipped)).toEqual([]);
    expect(SYNC_SKIP_DIRS.has('.next')).toBe(true);
  });

  it('skips generic build folder names only at the project root', async () => {
    const { socket } = await setup(async (workspace) => {
      await workspace.createFolder('demo', '', 'coverage');
      await workspace.createFile('demo', 'coverage', 'lcov.info', 'report');
      await workspace.createFolder('demo', '', 'target');
      await workspace.createFile('demo', 'target', 'app', 'bin');
      await workspace.createFolder('demo', '', 'src');
      await workspace.createFolder('demo', 'src', 'target');
      await workspace.createFile('demo', 'src/target', 'out.ts', 'o');
      await workspace.createFolder('demo', 'src', 'features');
      await workspace.createFolder('demo', 'src/features', 'coverage');
      await workspace.createFile('demo', 'src/features/coverage', 'Coverage.tsx', 'x');
      await workspace.createFolder('demo', 'src', 'node_modules');
      await workspace.createFile('demo', 'src/node_modules', 'dep.js', 'd');
    });
    const init = sent(socket)[0];
    const paths = init.type === 'init' ? init.files.map((f) => f.path) : [];
    expect(paths).toEqual(expect.arrayContaining(['src/target/out.ts', 'src/features/coverage/Coverage.tsx']));
    expect(paths).not.toEqual(expect.arrayContaining(['coverage/lcov.info']));
    expect(paths.some((p) => p.startsWith('target/') || p.includes('node_modules/'))).toBe(false);
    expect([...SYNC_ROOT_SKIP_DIRS].sort()).toEqual(['.cache', 'coverage', 'target', 'venv']);
  });

  it('agrees with the watcher on the size limit to the byte', async () => {
    expect(base64Bytes(b64(''))).toBe(0);
    for (const n of [1, 2, 3, 4, 5, MAX_SYNC_BYTES, MAX_SYNC_BYTES + 1]) expect(base64Bytes(Buffer.alloc(n).toString('base64'))).toBe(n);
    const { socket } = await setup(async (workspace) => {
      await workspace.createFile('demo', '', 'limit.bin', 'a'.repeat(MAX_SYNC_BYTES));
      await workspace.createFile('demo', '', 'over.bin', 'a'.repeat(MAX_SYNC_BYTES + 1));
    });
    const init = sent(socket)[0];
    const paths = init.type === 'init' ? init.files.map((f) => f.path) : [];
    expect(paths).toContain('limit.bin');
    expect(paths).not.toContain('over.bin');
  });

  it('splits a big project into init batches under the budget', async () => {
    const chunk = 'a'.repeat(1024 * 1024);
    const { socket } = await setup(async (workspace) => {
      for (let i = 0; i < 20; i++) await workspace.createFile('demo', '', `big${i}.txt`, chunk);
    });
    for (let i = 0; i < 10 && sent(socket).at(-1)?.type === 'init' && (sent(socket).at(-1) as { more?: boolean }).more; i++) {
      socket.receive({ type: 'init-ack' });
      await flush();
    }
    const inits = sent(socket).filter((m) => m.type === 'init');
    expect(inits.length).toBeGreaterThan(1);
    inits.forEach((m, i) => {
      if (m.type !== 'init') return;
      expect(m.more).toBe(i < inits.length - 1 ? true : undefined);
      expect(m.files.reduce((n, f) => n + f.data.length, 0)).toBeLessThanOrEqual(INIT_BATCH_BYTES);
    });
    const all = inits.flatMap((m) => (m.type === 'init' ? m.files.map((f) => f.path) : []));
    expect(all.filter((p) => p.startsWith('big'))).toHaveLength(20);
  });

  it('sends the next init batch only after the server acknowledged the last one', async () => {
    const chunk = 'a'.repeat(1024 * 1024);
    const { socket, hooks } = await setup(async (workspace) => {
      for (let i = 0; i < 20; i++) await workspace.createFile('demo', '', `big${i}.txt`, chunk);
    });
    const inits = () => sent(socket).filter((m) => m.type === 'init');
    expect(inits()).toHaveLength(1);
    await flush();
    expect(inits()).toHaveLength(1);
    // Container files arriving meanwhile don't unblock it, and don't deadlock behind it.
    socket.receive({ type: 'file', path: 'from-container.txt', data: b64('c') });
    await flush();
    expect(inits()).toHaveLength(1);
    // One more batch per ack, until the last (without `more`).
    for (let n = 2; (inits().at(-1) as { more?: boolean }).more; n++) {
      socket.receive({ type: 'init-ack' });
      await flush();
      expect(inits()).toHaveLength(n);
      await flush();
      expect(inits()).toHaveLength(n);
    }
    expect(inits().length).toBeGreaterThan(2);
    expect(sent(socket).at(-1)).toEqual({ type: 'ack', path: 'from-container.txt', ok: true });
    socket.receive({ type: 'ready' });
    await flush();
    expect(hooks.onReady).toHaveBeenCalled();
  });

  it('acknowledges every container file and delete, in order', async () => {
    const { socket } = await setup();
    socket.receive({ type: 'ready' });
    socket.receive({ type: 'file', path: 'a.txt', data: b64('a') });
    socket.receive({ type: 'file', path: 'a.txt', data: b64('a') });
    socket.receive({ type: 'delete', path: 'a.txt' });
    socket.receive({ type: 'delete', path: 'never-had.txt' });
    await flush();
    expect(sent(socket).filter((m) => m.type === 'ack')).toEqual([
      { type: 'ack', path: 'a.txt', ok: true },
      { type: 'ack', path: 'a.txt', ok: true },
      { type: 'ack', path: 'a.txt', ok: true },
      { type: 'ack', path: 'never-had.txt', ok: true },
    ]);
  });

  it('never sends a delete or a stale copy for a container file it could not store', async () => {
    const { socket, workspace, sync, hooks } = await setup();
    const onSyncError = jest.fn();
    (hooks as { onSyncError?: unknown }).onSyncError = onSyncError;
    socket.receive({ type: 'ready' });
    // ':' is not a valid name on the phone, so the write throws.
    socket.receive({ type: 'file', path: 'bad:name.txt', data: b64('x') });
    await flush();
    expect(sent(socket).at(-1)).toEqual({ type: 'ack', path: 'bad:name.txt', ok: false });
    expect(onSyncError).toHaveBeenCalledWith('bad:name.txt', expect.any(String));

    // A file the phone has, whose update fails: the old copy stays on disk but is the container's now.
    const failing = { ...workspace, writeBase64: jest.fn().mockRejectedValue(new Error('disk full')) };
    (sync as unknown as { files: unknown }).files = failing;
    socket.receive({ type: 'file', path: 'index.js', data: b64('newer in container') });
    await flush();
    (sync as unknown as { files: unknown }).files = workspace;
    expect(sent(socket).at(-1)).toEqual({ type: 'ack', path: 'index.js', ok: false });

    socket.sent.length = 0;
    await workspace.writeFile('demo', 'index.js', 'stale local edit');
    sync.changed(['index.js', 'bad:name.txt']);
    sync.changed();
    await flush();
    expect(socket.sent).toEqual([]);

    // Once the container sends it again and it can be stored, the phone owns it again.
    socket.receive({ type: 'file', path: 'index.js', data: b64('newer in container') });
    await flush();
    expect(await workspace.readFile('demo', 'index.js')).toBe('newer in container');
    socket.sent.length = 0;
    await workspace.writeFile('demo', 'index.js', 'mine');
    sync.changed(['index.js']);
    await flush();
    expect(socket.sent).toEqual([{ type: 'file', path: 'index.js', data: b64('mine') }]);
  });

  it('stops owning a file the container reports as too big', async () => {
    const { socket, workspace, sync, hooks } = await setup();
    socket.receive({ type: 'ready' });
    socket.receive({ type: 'skipped', path: 'index.js' });
    await flush();
    socket.sent.length = 0;
    await workspace.writeFile('demo', 'index.js', 'stale edit');
    sync.changed(['index.js']);
    sync.changed();
    await flush();
    expect(changes(socket)).toEqual([]);

    // Shrunk in the container: it syncs again.
    socket.receive({ type: 'file', path: 'index.js', data: b64('small again') });
    await flush();
    expect(await workspace.readFile('demo', 'index.js')).toBe('small again');
    await workspace.writeFile('demo', 'index.js', 'mine');
    sync.changed(['index.js']);
    await flush();
    expect(changes(socket)).toEqual([{ type: 'file', path: 'index.js', data: b64('mine') }]);

    // Deleted in the container while skipped: the stale copy goes too.
    socket.receive({ type: 'skipped', path: 'index.js' });
    socket.receive({ type: 'delete', path: 'index.js' });
    await flush();
    expect(await workspace.stat('demo', 'index.js')).toBeNull();
    expect(hooks.onTreeChanged).toHaveBeenCalled();
  });

  it('reports ports', async () => {
    const { socket, hooks } = await setup();
    socket.receive({ type: 'ports', ports: [3000] });
    await flush();
    expect(hooks.onPorts).toHaveBeenCalledWith([3000]);
  });
});

describe('RemotePty', () => {
  it('sends input and the size once connected, and shows output', () => {
    const socket = new FakeSocket();
    const out: string[] = [];
    const pty = new RemotePty(() => socket as unknown as WebSocket, (d) => out.push(d));
    pty.start();
    pty.resize(80, 24);
    pty.input('ignored before open');
    socket.open();
    pty.input('ls\r');
    socket.receive({ type: 'pty', data: 'index.js\r\n' });
    expect(socket.sent).toEqual([
      { type: 'resize', cols: 80, rows: 24 },
      { type: 'pty', data: 'ls\r' },
    ]);
    expect(out.join('')).toContain('index.js');
    socket.onclose?.({ reason: 'shell exited' });
    expect(out.join('')).toContain('Remote shell closed: shell exited');
  });
});

describe('settings', () => {
  it('normalizes and validates', () => {
    // No scheme: https://, so the token never goes out in the clear by default.
    expect(normalizeUrl(' tide.example.com/ ')).toBe('https://tide.example.com');
    expect(normalizeUrl(' 192.168.1.2:8787/ ')).toBe('https://192.168.1.2:8787');
    // An explicit http:// (and so every saved URL) is kept as it is.
    expect(normalizeUrl('http://192.168.1.2:8787')).toBe('http://192.168.1.2:8787');
    expect(normalizeUrl('HTTP://box.lan:8787')).toBe('HTTP://box.lan:8787');
    expect(normalizeUrl('https://tide.example.com')).toBe('https://tide.example.com');
    expect(validateSettings({ url: '', token: 'x'.repeat(16) })).toMatch(/URL/);
    expect(validateSettings({ url: 'http://a:1', token: 'short' })).toMatch(/16/);
    expect(validateSettings({ url: 'http://a:1', token: 'x'.repeat(16) })).toBeNull();
  });

  it('flags plain http:// only for hosts outside the local network', () => {
    for (const url of ['http://tide.example.com', 'http://8.8.8.8:8787', 'http://172.32.0.1', 'http://user@203.0.113.5/', 'http://[2001:db8::1]:8787']) {
      expect([url, isInsecureUrl(url)]).toEqual([url, true]);
    }
    for (const url of [
      'https://tide.example.com',
      'http://localhost:8787',
      'http://127.0.0.1:8787',
      'http://10.0.0.2',
      'http://172.16.4.1:8787',
      'http://192.168.1.20:8787',
      'http://169.254.1.1',
      'http://100.101.102.103:8787',
      'http://mybox.local:8787',
      'http://[::1]:8787',
      'http://[fd12:3456::1]:8787',
      'http://[fe80::1]',
      '',
    ]) {
      expect([url, isInsecureUrl(url)]).toEqual([url, false]);
    }
  });

  it('builds socket and preview URLs', () => {
    const settings = { url: 'https://tide.example.com', token: 't' };
    const session = { id: 'abc', project: 'demo', previewBase: '/p/key' };
    expect(socketUrl(settings, session, 'pty')).toBe('wss://tide.example.com/sessions/abc/pty');
    expect(previewUrl(settings, session, 3000)).toBe('https://tide.example.com/p/key/3000/');
  });
});

describe('server protocol', () => {
  const settings = { url: 'https://tide.example.com', token: 't' };
  const answer = (body: object) => (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

  it('accepts a server on the same sync protocol', async () => {
    const info = { id: 'a', project: 'demo', previewBase: '/p/k', protocol: 2 };
    await expect(openSession(settings, 'demo', answer(info))).resolves.toEqual(info);
  });

  it('refuses an older server, including one that predates the protocol number', async () => {
    await expect(openSession(settings, 'demo', answer({ id: 'a', project: 'demo', previewBase: '/p/k' }))).rejects.toThrow(/server is out of date/);
    expect(() => checkProtocol({ id: 'a', project: 'demo', previewBase: '/p/k', protocol: 1 })).toThrow(RemoteError);
  });

  it('refuses a newer server and says to update the app', () => {
    expect(() => checkProtocol({ id: 'a', project: 'demo', previewBase: '/p/k', protocol: 3 })).toThrow(/newer than this app/);
  });
});
