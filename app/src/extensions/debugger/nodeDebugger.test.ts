/**
 * @jest-environment node
 */
/// <reference types="node" />
// The Node debugger in the real supervisor: a worker thread debugged from the main thread.
import type { DebugCommand, DebugEvent, RunnerMessage } from '@shared/protocol';

import { stopRuns, supervisorRunner } from '../testing';

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));
afterAll(stopRuns);

// One supervisor for every test, as in the app: it owns the process's inspector session.
let runner: ReturnType<typeof supervisorRunner>;
beforeAll(() => {
  runner = supervisorRunner();
});
let runs = 0;

function session(script: string, breakpoints: number[], file = `projects/p/main${++runs}.js`) {
  const id = `dbg${runs}`;
  runner.file(file, script);
  const events: DebugEvent[] = [];
  let output = '';
  let exit: number | null = null;
  runner.run(
    { type: 'run', id, runtime: 'node', entry: file, cwd: 'projects/p', args: [], debug: { breakpoints: { [file]: breakpoints } } },
    (msg: RunnerMessage) => {
      if (msg.type === 'debug') events.push(msg.event);
      else if (msg.type === 'stdout' || msg.type === 'stderr') output += msg.data;
      else if (msg.type === 'exit') exit = msg.code;
    },
  );
  const until = <T>(pick: () => T | undefined, timeout = 10_000) =>
    new Promise<T>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const v = pick();
        if (v !== undefined) return resolve(v);
        if (Date.now() - start > timeout) return reject(new Error(`timed out; events: ${JSON.stringify(events)}; output: ${output}`));
        setTimeout(check, 10);
      };
      check();
    });
  let seen = 0;
  // The next event of a kind, after the ones already consumed.
  const next = <K extends DebugEvent['event']>(kind: K) =>
    until(() => {
      const i = events.findIndex((e, n) => n >= seen && e.event === kind);
      if (i === -1) return undefined;
      seen = i + 1;
      return events[i] as Extract<DebugEvent, { event: K }>;
    });
  const send = (command: DebugCommand) => runner.send({ type: 'debug', id, command });
  const kill = () => runner.send({ type: 'kill', id });
  return { file, events, next, send, kill, output: () => output, exited: () => until(() => (exit === null ? undefined : exit)) };
}

const SCRIPT = ['const items = [1, 2, 3];', 'function total(list) {', '  let sum = 0;', '  for (const n of list) sum += n;', '  return sum;', '}', 'const t = total(items);', 'console.log("total", t);', ''].join('\n');

describe('Node debugger', () => {
  it('stops at a breakpoint, shows variables, evaluates, steps and continues', async () => {
    const s = session(SCRIPT, [5]);
    const stopped = await s.next('stopped');
    expect(stopped.frames[0]).toMatchObject({ name: 'total', file: s.file, line: 5 });
    expect(stopped.frames[1]).toMatchObject({ file: s.file, line: 7 });
    const local = stopped.frames[0].scopes.find((sc) => sc.name === 'Local')!;

    s.send({ cmd: 'variables', ref: local.ref, req: 1 });
    const vars = await s.next('variables');
    expect(vars.req).toBe(1);
    expect(vars.variables).toEqual(
      expect.arrayContaining([
        { name: 'sum', value: '6', type: 'number', ref: 0 },
        expect.objectContaining({ name: 'list', value: 'Array(3)', type: 'array' }),
      ]),
    );
    const list = vars.variables.find((v) => v.name === 'list')!;
    s.send({ cmd: 'variables', ref: list.ref, req: 2 });
    expect((await s.next('variables')).variables.slice(0, 3).map((v) => v.value)).toEqual(['1', '2', '3']);

    s.send({ cmd: 'evaluate', expression: 'sum * 2', frame: 0, req: 3 });
    expect(await s.next('evaluated')).toMatchObject({ req: 3, result: { value: '12' } });
    s.send({ cmd: 'evaluate', expression: 'nope.x', frame: 0, req: 4 });
    expect(await s.next('evaluated')).toMatchObject({ req: 4, error: expect.stringContaining('nope is not defined') });

    // V8 finishes the assignment on line 7 before stopping in the caller.
    s.send({ cmd: 'stepOut' });
    await s.next('resumed');
    const out = (await s.next('stopped')).frames[0];
    expect(out.name).not.toBe('total');
    expect([7, 8]).toContain(out.line);
    s.send({ cmd: 'stepOver' });
    await s.next('resumed');
    expect((await s.next('stopped')).frames[0].line).toBeGreaterThan(out.line - 1);
    s.send({ cmd: 'continue' });
    expect(await s.exited()).toBe(0);
    expect(s.output()).toBe('total 6\n');
  }, 30_000);

  it('adds breakpoints while running and pauses a busy loop', async () => {
    const script = ['let i = 0;', 'const timer = setInterval(() => {', '  i++;', '}, 5);', ''].join('\n');
    const s = session(script, []);
    await new Promise((r) => setTimeout(r, 300));
    s.send({ cmd: 'setBreakpoints', file: s.file, lines: [3] });
    expect((await s.next('stopped')).frames[0]).toMatchObject({ line: 3 });
    s.send({ cmd: 'setBreakpoints', file: s.file, lines: [] });
    s.send({ cmd: 'continue' });
    await s.next('resumed');
    s.send({ cmd: 'pause' });
    expect(await s.next('stopped')).toMatchObject({ reason: expect.any(String) });
    s.kill();
    expect(await s.exited()).toBe(130);
  }, 30_000);

  it('reports an uncaught exception and ends, as without the debugger', async () => {
    const s = session('function boom() {\n  throw new Error("bad");\n}\nboom();\n', []);
    expect(await s.exited()).toBe(1);
    expect(s.output()).toMatch(/Error: bad\n\s+at boom/);
    expect(s.events.filter((e) => e.event === 'stopped')).toEqual([]);
  }, 30_000);

  it('leaves runs started during a debug session alone', async () => {
    const s = session(SCRIPT, [5]);
    await s.next('stopped');
    const outputs: string[] = [];
    let code: number | null = null;
    runner.file('projects/p/other.js', 'console.log("other ran")');
    runner.run({ type: 'run', id: 'plain', runtime: 'node', entry: 'projects/p/other.js', cwd: 'projects/p', args: [] }, (m) => {
      if (m.type === 'stdout') outputs.push(m.data);
      if (m.type === 'exit') code = m.code;
    });
    await new Promise((r) => setTimeout(r, 1000));
    expect(code).toBe(0);
    expect(outputs.join('')).toBe('other ran\n');
    s.send({ cmd: 'continue' });
    expect(await s.exited()).toBe(0);
  }, 30_000);
});
