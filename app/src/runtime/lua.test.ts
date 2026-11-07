import type { RunRequest } from '@shared/protocol';

import { createLuaRunner } from './lua';

it('runs Lua scripts through the tide:lua built-in with a path relative to the run folder', () => {
  const runs: RunRequest[] = [];
  const lua = createLuaRunner({ run: (req) => runs.push(req), send: () => undefined });
  lua.run({ type: 'run', id: 'r1', runtime: 'lua', entry: 'projects/demo/src/main.lua', cwd: 'projects/demo', args: ['x'] }, () => undefined);
  lua.run({ type: 'run', id: 'r2', runtime: 'lua', entry: 'projects/demo/game.lua', cwd: 'projects/demo/src', args: [] }, () => undefined);
  expect(runs.map((r) => [r.runtime, r.entry, r.args])).toEqual([
    ['node', 'tide:lua', ['src/main.lua', 'x']],
    ['node', 'tide:lua', ['../game.lua']],
  ]);
});
