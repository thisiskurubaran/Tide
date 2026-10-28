import type { RunnerMessage } from '@shared/protocol';

import { createPythonRunner, PythonHost } from './pythonRunner';

function fakeHost() {
  const listeners: Record<string, (e: never) => void> = {};
  const calls: unknown[][] = [];
  const host: PythonHost & { calls: unknown[][]; fire(event: string, payload: object): void; fail?: Error } = {
    calls,
    run: async (...args) => {
      calls.push(['run', ...args]);
      if (host.fail) throw host.fail;
    },
    write: async (...args) => void calls.push(['write', ...args]),
    kill: async (...args) => void calls.push(['kill', ...args]),
    addListener: ((event: string, cb: (e: never) => void) => {
      listeners[event] = cb;
    }) as PythonHost['addListener'],
    fire: (event, payload) => listeners[event]?.(payload as never),
  };
  return host;
}

const req = { type: 'run', id: 'r1', runtime: 'python', entry: 'projects/p/src/main.py', cwd: 'projects/p/src', args: ['x'] } as const;

describe('python runner', () => {
  it('passes absolute paths and the project .pylibs folder', () => {
    const host = fakeHost();
    createPythonRunner(host, () => '/docs').run({ ...req, args: ['x'] }, () => {});
    expect(host.calls[0]).toEqual(['run', 'r1', '/docs/projects/p/src/main.py', '/docs/projects/p/src', ['x'], ['/docs/projects/p/.pylibs'], '/docs']);
  });

  it('turns module events into runner messages', () => {
    const host = fakeHost();
    const got: RunnerMessage[] = [];
    const runner = createPythonRunner(host, () => '/docs');
    runner.run({ ...req, args: [] }, (m) => got.push(m));
    runner.run({ ...req, id: 'r2', args: [] }, () => {});
    host.fire('onOutput', { id: 'r1', kind: 'stdout', data: 'hi\n' });
    host.fire('onOutput', { id: 'r2', kind: 'stdout', data: 'other\n' });
    host.fire('onExit', { id: 'r1', code: 130, killed: true });
    host.fire('onOutput', { id: 'r1', kind: 'stdout', data: 'late' });
    expect(got).toEqual([
      { type: 'stdout', id: 'r1', data: 'hi\n' },
      { type: 'exit', id: 'r1', code: 130, signal: 'SIGINT' },
    ]);
  });

  it('forwards stdin and kill', () => {
    const host = fakeHost();
    const runner = createPythonRunner(host, () => '/docs');
    runner.send({ type: 'stdin', id: 'r1', data: 'Ada\n' });
    runner.send({ type: 'kill', id: 'r1' });
    expect(host.calls).toEqual([
      ['write', 'r1', 'Ada\n'],
      ['kill', 'r1'],
    ]);
  });

  it('reports a failed start as an exit', async () => {
    const host = fakeHost();
    host.fail = new Error('Python failed to start');
    const got: RunnerMessage[] = [];
    createPythonRunner(host, () => '/docs').run({ ...req, args: [] }, (m) => got.push(m));
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([
      { type: 'stderr', id: 'r1', data: 'Python failed to start\n' },
      { type: 'exit', id: 'r1', code: 1 },
    ]);
  });
});
