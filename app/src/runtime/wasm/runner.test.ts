import type { RunnerMessage } from '@shared/protocol';

import type { ToRuntime } from './protocol';
import { WasmRunner } from './runner';

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const sent: ToRuntime[] = [];
  const applied: unknown[] = [];
  let restarts = 0;
  const runner = new WasmRunner(
    { ready: async () => undefined, send: (m) => sent.push(m), restart: () => restarts++ },
    { read: async () => ({ 'main.rb': 'cHV0cyAx' }), apply: async (...a) => void applied.push(a) },
    async () => ({ ruby: 'file:///r.wasm', php: 'file:///p.wasm' }),
  );
  const got: RunnerMessage[] = [];
  return { runner, sent, applied, got, restarts: () => restarts };
}

describe('WasmRunner', () => {
  it('sends the run with project-relative paths and applies changed files on exit', async () => {
    const { runner, sent, applied, got } = setup();
    runner.run({ type: 'run', id: 'r1', runtime: 'ruby', entry: 'projects/demo/lib/main.rb', cwd: 'projects/demo/lib', args: ['x'] }, (m) => got.push(m));
    await tick();
    expect(sent[0]).toEqual({ type: 'init', ruby: 'file:///r.wasm', php: 'file:///p.wasm' });
    expect(sent[1]).toMatchObject({ type: 'run', id: 'r1', runtime: 'ruby', entry: 'lib/main.rb', cwd: 'lib', args: ['x'], files: { 'main.rb': 'cHV0cyAx' } });
    runner.receive({ type: 'stdout', id: 'r1', data: 'hi\n' });
    runner.receive({ type: 'exit', id: 'r1', code: 0, changed: { 'out.txt': 'eA==' }, removed: ['old.txt'] });
    await tick();
    expect(applied).toEqual([['demo', { 'out.txt': 'eA==' }, ['old.txt']]]);
    expect(got).toEqual([
      { type: 'stdout', id: 'r1', data: 'hi\n' },
      { type: 'exit', id: 'r1', code: 0 },
    ]);
  });

  it('stops a run by reloading the page', async () => {
    const { runner, got, restarts } = setup();
    runner.run({ type: 'run', id: 'r2', runtime: 'php', entry: 'projects/demo/loop.php', cwd: 'projects/demo', args: [] }, (m) => got.push(m));
    await tick();
    runner.send({ type: 'stdin', id: 'r2' });
    runner.send({ type: 'kill', id: 'r2' });
    expect(restarts()).toBe(1);
    expect(got.at(-1)).toEqual({ type: 'exit', id: 'r2', code: 130, signal: 'SIGINT' });
  });

  it('never sends a run that was killed while it was starting', async () => {
    const { runner, sent, got, restarts } = setup();
    runner.run({ type: 'run', id: 'r3', runtime: 'ruby', entry: 'projects/demo/main.rb', cwd: 'projects/demo', args: [] }, (m) => got.push(m));
    runner.send({ type: 'kill', id: 'r3' });
    expect(restarts()).toBe(1);
    await tick();
    await tick();
    expect(sent.filter((m) => m.type === 'run')).toEqual([]);
    expect(got).toEqual([{ type: 'exit', id: 'r3', code: 130, signal: 'SIGINT' }]);
  });

  it('a new run with the same id after a kill is still sent', async () => {
    const { runner, sent, got } = setup();
    runner.run({ type: 'run', id: 'r4', runtime: 'ruby', entry: 'projects/demo/main.rb', cwd: 'projects/demo', args: [] }, (m) => got.push(m));
    runner.send({ type: 'kill', id: 'r4' });
    runner.run({ type: 'run', id: 'r4', runtime: 'ruby', entry: 'projects/demo/main.rb', cwd: 'projects/demo', args: [] }, (m) => got.push(m));
    await tick();
    await tick();
    expect(sent.filter((m) => m.type === 'run')).toHaveLength(1);
  });
});
