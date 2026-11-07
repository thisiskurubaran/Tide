/**
 * @jest-environment node
 */
/// <reference types="node" />
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/lua/cli.js');
// nodejs-mobile on iOS has no WebAssembly; fengari is plain JavaScript and must not need it.
const TRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tide-lua-trap-')), 'trap.js');
fs.writeFileSync(TRAP, "Object.defineProperty(globalThis, 'WebAssembly', { configurable: true, get() { throw new Error('no WebAssembly'); } });");

function lua(files: Record<string, string>, args: string[], input = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-lua-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const r = spawnSync(process.execPath, ['-r', TRAP, CLI, ...args], { cwd: dir, input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, dir };
}

describe('tide:lua', () => {
  it('reads input, numbers, files and modules, and passes arguments', () => {
    const r = lua(
      {
        'main.lua': [
          'io.write("Name? ")',
          'local name = io.read()',
          'local n = io.read("n")',
          'print("Hello, " .. name, n * 2, math.type(n))',
          'local f = assert(io.open("out.txt", "w")) f:write("a\\n", "b\\n") f:close()',
          'local seen = {} for l in io.lines("out.txt") do seen[#seen + 1] = l end print(table.concat(seen, ","))',
          'print(require("util").twice(21), arg[0], arg[1])',
          'local missing, err = io.open("nope.txt") print(missing, err)',
        ].join('\n'),
        'util.lua': 'return { twice = function(x) return x * 2 end }',
      },
      ['main.lua', 'extra'],
      'Ada\n21\n',
    );
    expect(r.err).toBe('');
    expect(r.out).toBe('Name? Hello, Ada\t42\tinteger\na,b\n42\tmain.lua\textra\nnil\tnope.txt: No such file or directory\n');
    expect(fs.readFileSync(path.join(r.dir, 'out.txt'), 'utf8')).toBe('a\nb\n');
    expect(r.code).toBe(0);
  });

  it('returns nil at the end of input, and exits with os.exit', () => {
    const r = lua({ 'a.lua': 'print(io.read(), io.read())\nos.exit(4)' }, ['a.lua'], 'only\n');
    expect(r.out).toBe('only\tnil\n');
    expect(r.code).toBe(4);
  });

  it('reports errors with a traceback', () => {
    const r = lua({ 'bad.lua': 'local function f() error("boom") end\nf()' }, ['bad.lua']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('bad.lua:1: boom');
    expect(r.err).toContain('stack traceback');
  });
});
