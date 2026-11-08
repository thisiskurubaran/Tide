/**
 * @jest-environment node
 */
/// <reference types="node" />
import { spawnSync } from 'child_process';

import type { Notebook } from '../preview/render';
import { clearOutputs, codeCells, driverScript, parseResults, RESULT_PREFIX, RunStopped, startDriver, withOutputs } from './run';

const nb: Notebook = {
  cells: [
    { cell_type: 'markdown', source: ['# Title'] },
    { cell_type: 'code', source: ['x = 21\n', 'print("hi")'] },
    { cell_type: 'code', source: '%matplotlib inline\nx * 2' },
    { cell_type: 'code', source: 'import sys\nprint("oops", file=sys.stderr)\n1 / 0' },
    { cell_type: 'code', source: 'print("never")' },
  ],
} as Notebook;

const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('notebooks', () => {
  it('lists the code cells up to one', () => {
    expect(codeCells(nb).map(([i]) => i)).toEqual([1, 2, 3, 4]);
    expect(codeCells(nb, 2).map(([i]) => i)).toEqual([1, 2]);
  });

  (hasPython ? it : it.skip)('runs cells in one namespace, shows last values, and stops at an error', () => {
    const run = spawnSync('python3', ['-c', driverScript(codeCells(nb))], { encoding: 'utf8' });
    const results = parseResults(run.stdout);
    expect(results.map((r) => r.cell)).toEqual([1, 2, 3]);
    expect(results[0]).toMatchObject({ stdout: 'hi\n', result: null, error: null });
    expect(results[1]).toMatchObject({ result: '42', error: null });
    expect(results[2]).toMatchObject({ stderr: 'oops\n', error: { ename: 'ZeroDivisionError', evalue: 'division by zero' } });
    // The traceback is the cell's, not the driver's.
    expect(results[2].error!.traceback.join('')).toContain('<cell 3>');
    expect(results[2].error!.traceback.join('')).not.toContain('__tide');

    const out = withOutputs(nb, results);
    expect(out.cells[1]).toMatchObject({ execution_count: 1, outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }] });
    expect(out.cells[2]).toMatchObject({ execution_count: 2, outputs: [{ output_type: 'execute_result', execution_count: 2, data: { 'text/plain': '42' } }] });
    expect(out.cells[3].outputs!.map((o) => o.output_type)).toEqual(['stream', 'error']);
    expect(out.cells[4]).toEqual(nb.cells[4]);
    expect(clearOutputs(out).cells[1]).toMatchObject({ execution_count: null, outputs: [] });
  });
});

describe('startDriver', () => {
  const req = { type: 'run' as const, id: 'nb-1', runtime: 'python' as const, entry: 'x.py', cwd: '.', args: [], env: {} };
  const fakeRunner = () => {
    const sent: unknown[] = [];
    let emit: (msg: { type: string; id: string; data?: string; code?: number }) => void = () => undefined;
    return {
      sent,
      emit: (msg: { type: string; data?: string; code?: number }) => emit({ id: req.id, ...msg }),
      runner: {
        run: (_req: unknown, onMessage: typeof emit) => {
          emit = onMessage;
        },
        send: (msg: unknown) => sent.push(msg),
      },
    };
  };

  it('resolves with the output once the driver exits', async () => {
    const fake = fakeRunner();
    const run = startDriver(fake.runner as never, req);
    fake.emit({ type: 'stdout', data: `${RESULT_PREFIX}{}\n` });
    fake.emit({ type: 'exit', code: 0 });
    await expect(run.result).resolves.toContain('tide-nb');
  });

  it('Stop kills the run and gives up at once, even if the runtime never exits', async () => {
    const fake = fakeRunner();
    const run = startDriver(fake.runner as never, req);
    run.stop();
    await expect(run.result).rejects.toBeInstanceOf(RunStopped);
    expect(fake.sent).toEqual([{ type: 'kill', id: 'nb-1' }]);
  });

  it('times out a run that never finishes', async () => {
    jest.useFakeTimers();
    try {
      const fake = fakeRunner();
      const run = startDriver(fake.runner as never, req, 1000);
      const settled = run.result.catch((e) => e);
      jest.advanceTimersByTime(1000);
      expect(await settled).toBeInstanceOf(RunStopped);
      expect(fake.sent).toEqual([{ type: 'kill', id: 'nb-1' }]);
    } finally {
      jest.useRealTimers();
    }
  });
});
