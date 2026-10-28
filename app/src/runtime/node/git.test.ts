/**
 * @jest-environment node
 */
/// <reference types="node" />
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const { porcelainCode } = require('../../../nodejs-assets/nodejs-project/git/status');
const { lineStat } = require('../../../nodejs-assets/nodejs-project/git/diffstat');
/* eslint-enable @typescript-eslint/no-require-imports */

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/git/cli.js');

// nodejs-mobile on iOS has no WebAssembly, so anything that loads Node's fetch
// (undici) fails there. Make that fail here too.
const TRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tide-git-trap-')), 'trap.js');
fs.writeFileSync(
  TRAP,
  "for (const n of ['fetch', 'Request', 'Response', 'Headers', 'WebAssembly']) Object.defineProperty(globalThis, n, { configurable: true, get() { throw new Error(n + ' is not available on the device'); } });",
);

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  try {
    const out = execFileSync(process.execPath, ['-r', TRAP, CLI, ...args], {
      cwd,
      env: { ...process.env, TIDE_GIT_TOKEN: '', TIDE_GIT_NAME: 'Test', TIDE_GIT_EMAIL: 't@example.com', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

describe('porcelainCode', () => {
  it('maps status matrix rows like git status --porcelain', () => {
    expect(porcelainCode(['a', 0, 2, 0])).toBe('??');
    expect(porcelainCode(['a', 0, 2, 2])).toBe('A ');
    expect(porcelainCode(['a', 0, 2, 3])).toBe('AM');
    expect(porcelainCode(['a', 1, 1, 1])).toBeNull();
    expect(porcelainCode(['a', 1, 2, 1])).toBe(' M');
    expect(porcelainCode(['a', 1, 2, 2])).toBe('M ');
    expect(porcelainCode(['a', 1, 2, 3])).toBe('MM');
    expect(porcelainCode(['a', 1, 0, 1])).toBe(' D');
    expect(porcelainCode(['a', 1, 0, 0])).toBe('D ');
  });
});

describe('lineStat', () => {
  it('counts added and removed lines', () => {
    expect(lineStat('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual({ added: 2, removed: 1 });
    expect(lineStat('hi\n', '')).toEqual({ added: 0, removed: 1 });
    expect(lineStat('', 'x\ny')).toEqual({ added: 2, removed: 0 });
  });
});

describe('git cli', () => {
  it('inits, stages, commits and logs a repository real git can read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-git-'));
    expect(git(dir, ['init']).code).toBe(0);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    expect(git(dir, ['status', '-s']).out).toBe('?? a.txt\n');
    git(dir, ['add', '-A']);
    expect(git(dir, ['commit', '-m', 'first']).out).toMatch(/^\[main [0-9a-f]{7}\] first/);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    expect(git(dir, ['commit', '-am', 'second']).code).toBe(0);
    expect(git(dir, ['log', '--oneline']).out).toMatch(/second\n.*first\n$/);
    expect(execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' })).toBe('second\nfirst\n');
  });

  it('explains what is missing instead of failing obscurely', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-git-'));
    expect(git(dir, ['status'])).toEqual({ code: 128, out: 'fatal: not a git repository (run git init or git clone first)\n' });
    git(dir, ['init']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    git(dir, ['add', 'a.txt']);
    expect(git(dir, ['commit', '-m', 'x'], { TIDE_GIT_NAME: '' }).out).toMatch(/Settings, Git/);
    expect(git(dir, ['rebase']).out).toMatch(/not available locally/);
  });
});
