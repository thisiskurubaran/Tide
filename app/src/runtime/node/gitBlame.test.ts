/**
 * @jest-environment node
 */
/// <reference types="node" />
// The blame tide:git works out (git/blame.js), checked against real git.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { blame, carriedOver } = require('../../../nodejs-assets/nodejs-project/git/blame.js');

describe('blame', () => {
  it('matches lines carried over between versions', () => {
    expect([...carriedOver(['a', 'b', 'c'], ['a', 'x', 'c'])]).toEqual([0, -1, 2]);
    expect([...carriedOver(['a', 'b', 'c', 'd'], ['b', 'd', 'e'])]).toEqual([1, 3, -1]);
    expect([...carriedOver([], ['a'])]).toEqual([-1]);
  });

  it('gives each line to the newest version that added it', () => {
    expect(
      blame([
        { oid: null, text: 'one\nTWO\nthree\nfour\nnew\n' },
        { oid: 'c3', text: 'one\ntwo\nthree\nfour\n' },
        { oid: 'c2', text: 'one\ntwo\nthree\n' },
        { oid: 'c1', text: 'one\nthree\n' },
      ]),
    ).toEqual([
      { oid: 'c1', start: 1, count: 1 },
      { oid: null, start: 2, count: 1 },
      { oid: 'c1', start: 3, count: 1 },
      { oid: 'c3', start: 4, count: 1 },
      { oid: null, start: 5, count: 1 },
    ]);
  });

  const hasGit = (() => {
    try {
      execFileSync('git', ['--version']);
      return true;
    } catch {
      return false;
    }
  })();
  (hasGit ? it : it.skip)('agrees with git blame on a real repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-blame-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    const write = (t: string) => fs.writeFileSync(path.join(dir, 'f.txt'), t);
    git('init', '-q');
    const versions: { oid: string | null; text: string }[] = [];
    for (const text of ['a\nb\nc\n', 'a\nB\nc\nd\n', 'x\na\nB\nc\nd\n', 'x\na\nB\nd\ne\n']) {
      write(text);
      git('add', 'f.txt');
      git('commit', '-qm', 'step');
      versions.unshift({ oid: git('rev-parse', 'HEAD').trim(), text });
    }
    const expected = git('blame', '--porcelain', 'f.txt')
      .split('\n')
      .filter((l) => /^[0-9a-f]{40} \d+ \d+/.test(l))
      .map((l) => l.split(' ')[0]);
    const runs: { oid: string; count: number }[] = blame(versions);
    expect(runs.flatMap((r) => Array(r.count).fill(r.oid))).toEqual(expected);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
