import type { RunnerMessage, RunRequest } from '@shared/protocol';

import { createNodeRunner, NodeHost } from './nodeRunner';

function fakeHost() {
  let listener: ((msg: string) => void) | undefined;
  const host: NodeHost & { starts: number; sent: unknown[]; emit(msg: object): void } = {
    starts: 0,
    sent: [],
    start() {
      host.starts++;
    },
    channel: {
      addListener: (_e, cb) => {
        listener = cb;
      },
      send: (raw) => host.sent.push(JSON.parse(raw)),
    },
    emit: (msg) => listener?.(JSON.stringify(msg)),
  };
  return host;
}

const req: RunRequest = { type: 'run', id: 'r1', runtime: 'node', entry: 'projects/p/index.js', cwd: 'projects/p', args: [] };

describe('node runner', () => {
  it('starts node once, sends init on ready, then flushes queued messages', () => {
    const host = fakeHost();
    const runner = createNodeRunner(host, () => '/docs');
    runner.run(req, () => {});
    runner.send({ type: 'stdin', id: 'r1', data: 'x\n' });
    expect(host.starts).toBe(1);
    expect(host.sent).toEqual([]);
    host.emit({ type: 'ready', node: 'v18' });
    expect(host.sent).toEqual([{ type: 'init', root: '/docs' }, req, { type: 'stdin', id: 'r1', data: 'x\n' }]);
    runner.run({ ...req, id: 'r2' }, () => {});
    expect(host.starts).toBe(1);
  });

  it('routes output to the run that produced it and forgets it after exit', () => {
    const host = fakeHost();
    const runner = createNodeRunner(host, () => '/docs');
    const a: RunnerMessage[] = [];
    const b: RunnerMessage[] = [];
    runner.run(req, (m) => a.push(m));
    runner.run({ ...req, id: 'r2' }, (m) => b.push(m));
    host.emit({ type: 'ready', node: 'v18' });
    host.emit({ type: 'stdout', id: 'r1', data: 'one' });
    host.emit({ type: 'stderr', id: 'r2', data: 'two' });
    host.emit({ type: 'exit', id: 'r1', code: 0 });
    host.emit({ type: 'stdout', id: 'r1', data: 'late' });
    expect(a).toEqual([
      { type: 'stdout', id: 'r1', data: 'one' },
      { type: 'exit', id: 'r1', code: 0 },
    ]);
    expect(b).toEqual([{ type: 'stderr', id: 'r2', data: 'two' }]);
  });

  it('answers ping with the supervisor pong', async () => {
    const host = fakeHost();
    const runner = createNodeRunner(host, () => '/docs');
    const pong = runner.ping();
    host.emit({ type: 'ready', node: 'v18' });
    host.emit({ type: 'pong', node: 'v18.20.4', platform: 'ios', arch: 'arm64' });
    await expect(pong).resolves.toMatchObject({ node: 'v18.20.4', platform: 'ios' });
  });
});
