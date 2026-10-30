/**
 * @jest-environment node
 */
/// <reference types="node" />
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const { Server, utils } = require('ssh2');
const { STATUS_CODE, OPEN_MODE } = utils.sftp;
/* eslint-enable @typescript-eslint/no-require-imports */

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/ssh/cli.js');

// nodejs-mobile on iOS has no WebAssembly; the bundled ssh2 must work without it.
const TRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tide-ssh-trap-')), 'trap.js');
fs.writeFileSync(TRAP, "Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, get() { throw new Error('WebAssembly is not available on the device'); } });");

function run(
  mode: string,
  config: object,
  input: (write: (s: string) => void, stdout: () => string, end: () => void, kill: () => void) => void = (_w, _o, end) => end(),
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['-r', TRAP, CLI, mode], { env: { ...process.env, TIDE_SSH: JSON.stringify(config) } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    input(
      (s) => child.stdin.write(s),
      () => stdout,
      () => child.stdin.end(),
      () => child.kill(),
    );
  });
}

const until = async (check: () => boolean, ms = 5000) => {
  for (let t = 0; t < ms && !check(); t += 20) await new Promise((r) => setTimeout(r, 20));
};

describe('tide:ssh', () => {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-sftp-'));
  const windows: [number, number][] = [];
  let server: any;
  let port = 0;

  beforeAll(async () => {
    server = new Server({ hostKeys: [hostKey] }, (client: any) => {
      // Refusing a changed host key hangs up mid key exchange.
      client.on('error', () => undefined);
      client.on('authentication', (ctx: any) => (ctx.method === 'password' && ctx.username === 'ada' && ctx.password === 'pw' ? ctx.accept() : ctx.reject(['password'])));
      // Tunnels, for port forwarding and jump hosts.
      client.on('tcpip', (accept: any, _reject: any, info: any) => {
        const stream = accept();
        const sock = net.connect(info.destPort, info.destIP);
        stream.pipe(sock).pipe(stream);
        sock.on('error', () => stream.destroy());
      });
      client.on('session', (accept: any) => {
        const session = accept();
        session.on('pty', (ok: any) => ok && ok());
        session.on('window-change', (ok: any, _r: any, info: any) => {
          windows.push([info.cols, info.rows]);
          ok?.();
        });
        session.on('shell', (ok: any) => {
          const stream = ok();
          stream.write('welcome\r\n');
          stream.on('data', (d: Buffer) => {
            const text = d.toString();
            if (text.includes('exit')) {
              stream.exit(0);
              stream.end();
            } else stream.write(`echo:${text}`);
          });
        });
        session.on('sftp', (ok: any) => sftpServer(ok(), root));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(() => server.close());

  const base = () => ({ host: '127.0.0.1', port, username: 'ada', password: 'pw' });

  it('generates ed25519 keys and reads the public key back', async () => {
    const gen = await run('keygen', { comment: 'phone' });
    const keys = JSON.parse(gen.stdout);
    expect(keys.publicKey).toMatch(/^ssh-ed25519 \S+ phone$/);
    const pub = await run('pubkey', { privateKey: keys.privateKey });
    expect(JSON.parse(pub.stdout).publicKey).toBe(keys.publicKey);
  });

  it('opens a shell, passes keys through, resizes, and reports a new host key', async () => {
    const r = await run('shell', { ...base(), cols: 100, rows: 30 }, async (write, stdout, end) => {
      await until(() => stdout().includes('welcome'));
      write('hi\n');
      await until(() => stdout().includes('echo:hi'));
      write('\x1b]tide-resize;120;40\x07');
      await until(() => windows.length > 0);
      write('exit\n');
      end();
    });
    expect(r.stdout).toContain('welcome');
    expect(r.stdout).toContain('echo:hi');
    expect(r.stdout).not.toContain('tide-resize');
    expect(windows).toContainEqual([120, 40]);
    expect(r.stderr).toMatch(/^TIDE-HOSTKEY SHA256:[A-Za-z0-9+/]+$/m);
    expect(r.code).toBe(0);
  }, 20000);

  it('refuses a host whose key changed', async () => {
    const r = await run('shell', { ...base(), fingerprint: 'SHA256:somethingelse' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('host key for 127.0.0.1 has changed');
  }, 20000);

  it('says when sign-in is refused', async () => {
    const r = await run('shell', { ...base(), password: 'wrong' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Sign-in was refused');
  }, 20000);

  it('forwards a local port to a port on the server', async () => {
    const web = http.createServer((_req, res) => res.end('hello through the tunnel'));
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
    const remotePort = (web.address() as net.AddressInfo).port;
    const localPort = 20000 + Math.floor(Math.random() * 20000);
    let body = '';
    await run('forward', { ...base(), forward: { localPort, remotePort } }, async (_write, stdout, _end, kill) => {
      await until(() => stdout().includes('Forwarding'));
      body = await new Promise<string>((resolve, reject) =>
        http.get(`http://127.0.0.1:${localPort}/`, (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve(d));
        }).on('error', reject),
      );
      // Forwarding runs until stopped, like the app's Stop button.
      kill();
    });
    web.close();
    expect(body).toBe('hello through the tunnel');
  }, 30000);

  it('connects through a jump host and checks both host keys', async () => {
    // The same test server is both the jump host and the target, reached through the tunnel.
    const r = await run('shell', { ...base(), host: '127.0.0.1', jump: base() }, async (write, stdout, end) => {
      await until(() => stdout().includes('welcome'));
      write('exit\n');
      end();
    });
    expect(r.stdout).toContain('welcome');
    expect(r.stderr).toMatch(/^TIDE-HOSTKEY-JUMP SHA256:/m);
    expect(r.stderr).toMatch(/^TIDE-HOSTKEY SHA256:/m);
  }, 30000);

  it('browses, reads, writes, renames and removes files over SFTP', async () => {
    fs.writeFileSync(path.join(root, 'hello.txt'), 'hello');
    fs.mkdirSync(path.join(root, 'site'));
    const replies: any[] = [];
    await run('sftp', base(), async (write, stdout, end) => {
      const ask = async (req: { id: number; [key: string]: unknown }) => {
        write(`${JSON.stringify(req)}\n`);
        await until(() => stdout().split('\n').some((l) => l.includes(`"id":${req.id},`)));
      };
      await until(() => stdout().includes('"ready":true'));
      await ask({ id: 1, op: 'list', path: '/' });
      await ask({ id: 2, op: 'read', path: '/hello.txt' });
      await ask({ id: 3, op: 'write', path: '/site/index.html', base64: Buffer.from('<h1>hi</h1>').toString('base64') });
      await ask({ id: 4, op: 'rename', path: '/hello.txt', to: '/greeting.txt' });
      await ask({ id: 5, op: 'mkdir', path: '/new' });
      await ask({ id: 6, op: 'remove', path: '/new' });
      await ask({ id: 7, op: 'read', path: '/missing.txt' });
      write('{"op":"close"}\n');
      end();
      for (const l of stdout().split('\n')) if (l.startsWith('{"id"')) replies.push(JSON.parse(l));
    });
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
    expect(byId[1].result.map((e: any) => `${e.kind}:${e.name}`)).toEqual(['dir:site', 'file:hello.txt']);
    expect(Buffer.from(byId[2].result.base64, 'base64').toString()).toBe('hello');
    expect(fs.readFileSync(path.join(root, 'site/index.html'), 'utf8')).toBe('<h1>hi</h1>');
    expect(fs.existsSync(path.join(root, 'greeting.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'new'))).toBe(false);
    expect(byId[7].ok).toBe(false);
  }, 30000);
});

// A small SFTP server over a folder, for the operations tide:ssh uses.
function sftpServer(sftp: any, root: string) {
  const handles = new Map<number, { path: string; fd?: number; listed?: boolean }>();
  let next = 0;
  const real = (p: string) => path.join(root, path.posix.normalize(`/${p}`));
  const handle = (entry: { path: string; fd?: number }) => {
    const id = next++;
    handles.set(id, entry);
    const b = Buffer.alloc(4);
    b.writeUInt32BE(id);
    return b;
  };
  const get = (b: Buffer) => handles.get(b.readUInt32BE(0));
  const attrs = (st: fs.Stats) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: st.atimeMs / 1000, mtime: st.mtimeMs / 1000 });
  const fail = (id: number) => sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
  sftp.on('REALPATH', (id: number, p: string) => sftp.name(id, [{ filename: path.posix.normalize(`/${p}`), longname: '', attrs: {} }]));
  sftp.on('STAT', (id: number, p: string) => (fs.existsSync(real(p)) ? sftp.attrs(id, attrs(fs.statSync(real(p)))) : fail(id)));
  sftp.on('LSTAT', (id: number, p: string) => (fs.existsSync(real(p)) ? sftp.attrs(id, attrs(fs.lstatSync(real(p)))) : fail(id)));
  sftp.on('FSTAT', (id: number, h: Buffer) => sftp.attrs(id, attrs(fs.fstatSync(get(h)!.fd!))));
  sftp.on('OPENDIR', (id: number, p: string) => (fs.existsSync(real(p)) ? sftp.handle(id, handle({ path: real(p) })) : fail(id)));
  sftp.on('READDIR', (id: number, h: Buffer) => {
    const entry = get(h)!;
    if (entry.listed) return sftp.status(id, STATUS_CODE.EOF);
    entry.listed = true;
    sftp.name(id, fs.readdirSync(entry.path).map((n) => ({ filename: n, longname: n, attrs: attrs(fs.statSync(path.join(entry.path, n))) })));
  });
  sftp.on('OPEN', (id: number, p: string, flags: number) => {
    const write = flags & OPEN_MODE.WRITE;
    if (!write && !fs.existsSync(real(p))) return fail(id);
    sftp.handle(id, handle({ path: real(p), fd: fs.openSync(real(p), write ? 'w' : 'r') }));
  });
  sftp.on('READ', (id: number, h: Buffer, offset: number, length: number) => {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(get(h)!.fd!, buf, 0, length, offset);
    if (n === 0) return sftp.status(id, STATUS_CODE.EOF);
    sftp.data(id, buf.subarray(0, n));
  });
  sftp.on('WRITE', (id: number, h: Buffer, offset: number, data: Buffer) => {
    fs.writeSync(get(h)!.fd!, data, 0, data.length, offset);
    sftp.status(id, STATUS_CODE.OK);
  });
  sftp.on('CLOSE', (id: number, h: Buffer) => {
    const entry = get(h);
    if (entry?.fd !== undefined) fs.closeSync(entry.fd);
    sftp.status(id, STATUS_CODE.OK);
  });
  sftp.on('MKDIR', (id: number, p: string) => {
    fs.mkdirSync(real(p));
    sftp.status(id, STATUS_CODE.OK);
  });
  sftp.on('RMDIR', (id: number, p: string) => {
    fs.rmdirSync(real(p));
    sftp.status(id, STATUS_CODE.OK);
  });
  sftp.on('REMOVE', (id: number, p: string) => {
    fs.unlinkSync(real(p));
    sftp.status(id, STATUS_CODE.OK);
  });
  sftp.on('RENAME', (id: number, from: string, to: string) => {
    fs.renameSync(real(from), real(to));
    sftp.status(id, STATUS_CODE.OK);
  });
}
