import type { SyncToApp, SyncToServer } from '@shared/protocol';

import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { previewUrl, socketUrl } from './api';
import { RemotePty } from './pty';
import { normalizeUrl, validateSettings } from './settings';
import { INIT_BATCH_BYTES, RemoteSync } from './sync';
import { isSyncSkipped, SYNC_SKIP_DIRS } from './syncRules';

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
    expect(socket.sent).toEqual([]);

    socket.receive({ type: 'delete', path: 'made.txt' });
    await flush();
    expect(await workspace.stat('demo', 'made.txt')).toBeNull();
    expect(socket.sent).toEqual([]);
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

  it('splits a big project into init batches under the budget', async () => {
    const chunk = 'a'.repeat(1024 * 1024);
    const { socket } = await setup(async (workspace) => {
      for (let i = 0; i < 20; i++) await workspace.createFile('demo', '', `big${i}.txt`, chunk);
    });
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
    expect(socket.sent).toEqual([]);

    // Shrunk in the container: it syncs again.
    socket.receive({ type: 'file', path: 'index.js', data: b64('small again') });
    await flush();
    expect(await workspace.readFile('demo', 'index.js')).toBe('small again');
    await workspace.writeFile('demo', 'index.js', 'mine');
    sync.changed(['index.js']);
    await flush();
    expect(socket.sent).toEqual([{ type: 'file', path: 'index.js', data: b64('mine') }]);

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
    expect(normalizeUrl(' 192.168.1.2:8787/ ')).toBe('http://192.168.1.2:8787');
    expect(normalizeUrl('https://tide.example.com')).toBe('https://tide.example.com');
    expect(validateSettings({ url: '', token: 'x'.repeat(16) })).toMatch(/URL/);
    expect(validateSettings({ url: 'http://a:1', token: 'short' })).toMatch(/16/);
    expect(validateSettings({ url: 'http://a:1', token: 'x'.repeat(16) })).toBeNull();
  });

  it('builds socket and preview URLs', () => {
    const settings = { url: 'https://tide.example.com', token: 't' };
    const session = { id: 'abc', project: 'demo', previewBase: '/p/key' };
    expect(socketUrl(settings, session, 'pty')).toBe('wss://tide.example.com/sessions/abc/pty');
    expect(previewUrl(settings, session, 3000)).toBe('https://tide.example.com/p/key/3000/');
  });
});
