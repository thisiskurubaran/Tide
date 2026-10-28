import type { SyncToApp, SyncToServer } from '@shared/protocol';

import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { previewUrl, socketUrl } from './api';
import { RemotePty } from './pty';
import { normalizeUrl, validateSettings } from './settings';
import { RemoteSync } from './sync';

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

async function setup() {
  const fs = createMemoryFs();
  const workspace = createWorkspace(fs);
  await workspace.createProject('demo', 'node-hello');
  await workspace.createFolder('demo', '', 'node_modules');
  await workspace.createFile('demo', 'node_modules', 'skip.js', 'x');
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

  it('ignores local changes until the first sync is done', async () => {
    const { socket, workspace, sync } = await setup();
    socket.sent.length = 0;
    await workspace.writeFile('demo', 'index.js', 'x');
    sync.changed(['index.js']);
    await flush();
    expect(socket.sent).toEqual([]);
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
