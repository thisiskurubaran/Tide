import type { RunnerMessage, RunRequest } from '@shared/protocol';

import type { Runner } from '../../runtime/runner';
import { SftpSession, SshBackend } from './client';

class FakeRunner implements Runner {
  runs: { req: RunRequest; on: (m: RunnerMessage) => void }[] = [];
  sent: any[] = [];
  run(req: RunRequest, on: (m: RunnerMessage) => void) {
    this.runs.push({ req, on });
  }
  send(msg: unknown) {
    this.sent.push(msg);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SshBackend', () => {
  it('starts tide:ssh with the size and no time limit, and passes keys and resizes', async () => {
    const runner = new FakeRunner();
    let out = '';
    const hostKeys: string[] = [];
    const ssh = new SshBackend(runner, 'ada@box', async () => ({ host: 'box', password: 'pw' }), (d) => (out += d), (fp) => hostKeys.push(fp));
    ssh.resize(100, 30);
    ssh.start();
    await tick();
    const { req, on } = runner.runs[0];
    expect(req).toMatchObject({ entry: 'tide:ssh', args: ['shell'], limits: { timeoutMs: 0 } });
    expect(JSON.parse(req.env!.TIDE_SSH)).toEqual({ host: 'box', password: 'pw', cols: 100, rows: 30 });
    on({ type: 'stderr', id: req.id, data: 'TIDE-HOSTKEY SHA256:abc\n' });
    on({ type: 'stdout', id: req.id, data: 'ada@box:~$ ' });
    expect(hostKeys).toEqual(['SHA256:abc']);
    expect(out).toContain('ada@box:~$ ');
    ssh.input('ls\r');
    ssh.resize(120, 40);
    expect(runner.sent).toEqual([
      { type: 'stdin', id: req.id, data: 'ls\r' },
      { type: 'stdin', id: req.id, data: '\x1b]tide-resize;120;40\x07' },
    ]);
    on({ type: 'exit', id: req.id, code: 0 });
    expect(out).toContain('Connection closed.');
  });
});

describe('SftpSession', () => {
  it('waits for the connection, then matches replies to requests', async () => {
    const runner = new FakeRunner();
    const sftp = new SftpSession(runner, { host: 'box' }, () => undefined);
    const { req, on } = runner.runs[0];
    const listing = sftp.list('/var/www');
    await tick();
    expect(runner.sent).toEqual([]);
    on({ type: 'stdout', id: req.id, data: '{"ready":true,"home":"."}\n' });
    await tick();
    expect(JSON.parse(runner.sent[0].data)).toEqual({ id: 1, op: 'list', path: '/var/www' });
    on({ type: 'stdout', id: req.id, data: '{"id":1,"ok":true,"result":[{"name":"index.html","kind":"file","size":5,"mtime":0}]}\n' });
    expect(await listing).toEqual([{ name: 'index.html', kind: 'file', size: 5, mtime: 0 }]);
    const missing = sftp.read('/nope');
    await tick();
    on({ type: 'stdout', id: req.id, data: '{"id":2,"ok":false,"error":"No such file"}\n' });
    await expect(missing).rejects.toThrow('No such file');
  });

  it('fails waiting requests with the reason when the connection ends', async () => {
    const runner = new FakeRunner();
    const sftp = new SftpSession(runner, {}, () => undefined);
    const { req, on } = runner.runs[0];
    const listing = sftp.list('/');
    on({ type: 'stderr', id: req.id, data: 'Sign-in was refused. Check the username, password or key.\n' });
    on({ type: 'exit', id: req.id, code: 1 });
    await expect(listing).rejects.toThrow('Sign-in was refused');
  });
});
