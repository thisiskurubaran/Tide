import type { ClientMessage, RunnerMessage, RunRequest } from '@shared/protocol';

import { createMemoryFs } from '../../features/files/memoryFs';
import type { Runner } from '../../runtime/runner';
import { createFsStorage } from '../../state/storage';
import { createBreakpointsStore } from './breakpoints';
import { createDebugStore, projectFrame, runtimeFor } from './session';

jest.mock('../../state', () => ({ storage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));

function fakeRunner() {
  const sent: ClientMessage[] = [];
  let request: RunRequest | null = null;
  let reply: (msg: RunnerMessage) => void = () => undefined;
  const runner: Runner = {
    run(req, onMessage) {
      request = req;
      reply = onMessage;
    },
    send: (msg) => void sent.push(msg),
  };
  return { runner, sent, request: () => request!, reply: (msg: RunnerMessage) => reply(msg) };
}

const frame = (file: string | null, line: number) => ({ name: 'f', file, line, column: 1, scopes: [{ name: 'Local', ref: 1 }] });

describe('debug session', () => {
  it('starts with the project breakpoints and follows a pause', () => {
    const r = fakeRunner();
    const bps = createBreakpointsStore(createFsStorage(createMemoryFs()));
    bps.getState().set('p', 'main.py', [3]);
    const debug = createDebugStore(r.runner, bps);
    debug.getState().start('p', 'main.py');
    expect(r.request()).toMatchObject({ runtime: 'python', entry: 'projects/p/main.py', cwd: 'projects/p', debug: { breakpoints: { 'projects/p/main.py': [3] } } });

    const id = r.request().id;
    r.reply({ type: 'debug', id, event: { event: 'stopped', reason: 'breakpoint', frames: [frame(null, 9), frame('projects/p/main.py', 3)] } });
    expect(debug.getState()).toMatchObject({ status: 'paused', frame: 1 });
    expect(bps.getState().paused).toEqual({ project: 'p', path: 'main.py', line: 3 });
    // Locals of the shown frame are asked for at once.
    expect(r.sent).toContainEqual({ type: 'debug', id, command: { cmd: 'variables', ref: 1, req: 1 } });
    r.reply({ type: 'debug', id, event: { event: 'variables', req: 1, variables: [{ name: 'x', value: '1', type: 'int', ref: 0 }] } });
    expect(debug.getState().variables[1]).toEqual([{ name: 'x', value: '1', type: 'int', ref: 0 }]);

    debug.getState().command('continue');
    r.reply({ type: 'debug', id, event: { event: 'resumed' } });
    expect(debug.getState().status).toBe('running');
    expect(bps.getState().paused).toBeNull();

    r.reply({ type: 'stdout', id, data: 'hel' });
    r.reply({ type: 'stdout', id, data: 'lo\n' });
    r.reply({ type: 'exit', id, code: 0 });
    expect(debug.getState().status).toBe('ended');
    expect(debug.getState().console.map((l) => l.text)).toEqual(['Debugging main.py', 'hello\n', 'Exited with code 0.']);
  });

  it('sends breakpoint changes made while running', () => {
    const r = fakeRunner();
    const bps = createBreakpointsStore(createFsStorage(createMemoryFs()));
    const debug = createDebugStore(r.runner, bps);
    debug.getState().start('p', 'src/app.js');
    bps.getState().set('p', 'src/util.js', [4, 2]);
    bps.getState().set('other', 'x.js', [1]);
    expect(r.sent).toEqual([{ type: 'debug', id: r.request().id, command: { cmd: 'setBreakpoints', file: 'projects/p/src/util.js', lines: [2, 4] } }]);
  });

  it('logs evaluation results and errors', () => {
    const r = fakeRunner();
    const bps = createBreakpointsStore(createFsStorage(createMemoryFs()));
    const debug = createDebugStore(r.runner, bps);
    debug.getState().start('p', 'a.js');
    const id = r.request().id;
    debug.getState().evaluate('1 + 1');
    debug.getState().evaluate('nope');
    r.reply({ type: 'debug', id, event: { event: 'evaluated', req: 1, result: { name: '1 + 1', value: '2', type: 'number', ref: 0 } } });
    r.reply({ type: 'debug', id, event: { event: 'evaluated', req: 2, error: 'ReferenceError: nope is not defined' } });
    expect(debug.getState().console.slice(1)).toEqual([
      { kind: 'input', text: '1 + 1' },
      { kind: 'input', text: 'nope' },
      { kind: 'result', text: '2' },
      { kind: 'error', text: 'ReferenceError: nope is not defined' },
    ]);
  });

  it('only debugs JavaScript and Python', () => {
    expect(runtimeFor('a.mjs')).toBe('node');
    expect(runtimeFor('a.py')).toBe('python');
    expect(runtimeFor('a.ts')).toBeNull();
    expect(projectFrame([frame('projects/q/a.js', 1)], 'p')).toBeNull();
  });
});
