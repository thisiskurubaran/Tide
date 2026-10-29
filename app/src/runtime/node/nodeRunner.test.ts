import type { RunnerMessage, RunRequest } from '@shared/protocol';

import { createNodeRunner, NodeHost } from './nodeRunner';

// Wraps and unwraps the channel's numbered envelopes; `emitAt` sends with a chosen number.
function fakeHost() {
  let listener: ((msg: string) => void) | undefined;
  let emitted = 0;
  const host: NodeHost & {
    starts: number;
    sent: unknown[];
    numbers: number[];
    emit(msg: object): void;
    emitAt(n: number, msg: object): void;
  } = {
    starts: 0,
    sent: [],
    numbers: [],
    start() {
      host.starts++;
    },
    channel: {
      addListener: (_e, cb) => {
        listener = cb;
      },
      send: (raw) => {
        const env = JSON.parse(raw);
        host.numbers.push(env.n);
        host.sent.push(env.m);
      },
    },
    emit: (msg) => host.emitAt(emitted++, msg),
    emitAt: (n, msg) => listener?.(JSON.stringify({ n, m: msg })),
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
    expect(host.numbers).toEqual([0, 1, 2, 3]);
  });

  it('delivers messages from node in the order they were sent', () => {
    const host = fakeHost();
    const runner = createNodeRunner(host, () => '/docs');
    const out: RunnerMessage[] = [];
    runner.run(req, (m) => out.push(m));
    host.emitAt(2, { type: 'exit', id: 'r1', code: 0 });
    host.emitAt(1, { type: 'stdout', id: 'r1', data: 'b' });
    expect(host.sent).toEqual([]);
    host.emitAt(0, { type: 'ready', node: 'v18' });
    host.emitAt(1, { type: 'stdout', id: 'r1', data: 'duplicate' });
    expect(host.sent[0]).toEqual({ type: 'init', root: '/docs' });
    expect(out).toEqual([
      { type: 'stdout', id: 'r1', data: 'b' },
      { type: 'exit', id: 'r1', code: 0 },
    ]);
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
