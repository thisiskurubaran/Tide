/**
 * @jest-environment node
 */
/// <reference types="node" />
// Git Tools against the built-in git CLI on the host's Node, checked with real git.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { base64, createGitPro, isStaged, isUnstaged } from './api';
import { applyHunk, diffText, revertHunk } from './diff';

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/git/cli.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-gitpro-'));
  const run = async (args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd: dir,
      env: { ...process.env, TIDE_GIT_TOKEN: '', TIDE_GIT_NAME: 'Test', TIDE_GIT_EMAIL: 't@example.com' },
      encoding: 'utf8',
    });
    return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  const write = (rel: string, text: string) => fs.writeFileSync(path.join(dir, rel), text);
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const realGit = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { dir, run, write, read, realGit, api: createGitPro(run) };
}

async function init(r: ReturnType<typeof repo>) {
  await r.run(['init']);
  r.write('f.txt', Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  await r.run(['add', '-A']);
  await r.run(['commit', '-m', 'first']);
}

const hasGit = spawnSync('git', ['--version']).status === 0;
const withGit = hasGit ? describe : describe.skip;

describe('base64', () => {
  it('encodes UTF-8 like Buffer does', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'héllo wörld', '日本語', 'emoji 😀 ok', 'line\nbreak'])
      expect(base64(s)).toBe(Buffer.from(s, 'utf8').toString('base64'));
  });
});

withGit('git pro', () => {
  it('stages one hunk of a file and commits only that', async () => {
    const r = repo();
    await init(r);
    const before = r.read('f.txt');
    const lines = before.split('\n');
    lines[1] = 'line two changed';
    lines[17] = 'line eighteen changed';
    r.write('f.txt', lines.join('\n'));

    const status = await r.api.status();
    expect(status).toEqual({ branch: 'main', merging: null, changes: [{ path: 'f.txt', code: ' M' }] });
    const v = await r.api.show('f.txt');
    if (v.binary) throw new Error('binary');
    const hs = diffText(v.index!, v.work!)!;
    expect(hs).toHaveLength(2);
    await r.api.stageText('f.txt', applyHunk(v.index!, v.work!, hs[0]));

    const after = await r.api.status();
    expect(after.changes[0].code).toBe('MM');
    expect(isStaged(after.changes[0]) && isUnstaged(after.changes[0])).toBe(true);
    await r.api.commit('Change line 2 ✓');
    expect(r.realGit('show', 'HEAD:f.txt').split('\n')[1]).toBe('line two changed');
    expect(r.realGit('show', 'HEAD:f.txt').split('\n')[17]).toBe('line 18');
    expect(r.realGit('log', '-1', '--format=%s')).toBe('Change line 2 ✓\n');
    expect(r.realGit('status', '--porcelain')).toBe(' M f.txt\n');
  });

  it('unstages and discards a single hunk', async () => {
    const r = repo();
    await init(r);
    const lines = r.read('f.txt').split('\n');
    lines[0] = 'ONE';
    lines[19] = 'TWENTY';
    r.write('f.txt', lines.join('\n'));
    await r.api.stage(['f.txt']);
    // Unstage the second hunk: HEAD -> index, reverted in the index.
    let v = await r.api.show('f.txt');
    if (v.binary) throw new Error('binary');
    let hs = diffText(v.head!, v.index!)!;
    await r.api.stageText('f.txt', revertHunk(v.head!, v.index!, hs[1]));
    expect(r.realGit('diff', '--cached', '--stat')).toContain('1 insertion(+), 1 deletion(-)');
    // Discard the first hunk from the working tree: index -> work, reverted in the file.
    await r.api.unstage(['f.txt']);
    v = await r.api.show('f.txt');
    if (v.binary) throw new Error('binary');
    hs = diffText(v.index!, v.work!)!;
    r.write('f.txt', revertHunk(v.index!, v.work!, hs[0]));
    expect(r.read('f.txt').split('\n')[0]).toBe('line 1');
    expect(r.read('f.txt').split('\n')[19]).toBe('TWENTY');
    await r.api.discard(['f.txt']);
    expect(r.realGit('status', '--porcelain')).toBe('');
  });

  it('discards an untracked file by deleting it', async () => {
    const r = repo();
    await init(r);
    r.write('new.txt', 'x');
    await r.api.discard(['new.txt']);
    expect(fs.existsSync(path.join(r.dir, 'new.txt'))).toBe(false);
  });

  it('creates, switches and deletes branches', async () => {
    const r = repo();
    await init(r);
    await r.api.createBranch('feature');
    expect(await r.api.branches()).toEqual({ current: 'feature', local: ['feature', 'main'], remote: [] });
    await expect(r.api.deleteBranch('feature')).rejects.toThrow(/checked out/);
    await r.api.checkout('main');
    await r.api.deleteBranch('feature');
    expect((await r.api.branches()).local).toEqual(['main']);
  });

  it('merges a branch, and stops on a conflict until it is resolved and committed', async () => {
    const r = repo();
    await init(r);
    await r.api.createBranch('feature');
    r.write('f.txt', r.read('f.txt').replace('line 5', 'feature 5'));
    r.write('g.txt', 'from feature\n');
    await r.run(['add', '-A']);
    await r.run(['commit', '-m', 'feature work']);
    await r.api.checkout('main');
    // A clean merge brings the branch's files in.
    await expect(r.api.merge('feature')).resolves.toMatchObject({ conflicts: [], fastForward: true });
    expect(r.read('g.txt')).toBe('from feature\n');

    await r.api.createBranch('other');
    r.write('f.txt', r.read('f.txt').replace('line 10', 'other 10'));
    await r.run(['commit', '-a', '-m', 'other']);
    await r.api.checkout('main');
    r.write('f.txt', r.read('f.txt').replace('line 10', 'main 10'));
    await r.run(['commit', '-a', '-m', 'main']);
    await expect(r.api.merge('other')).resolves.toMatchObject({ conflicts: ['f.txt'] });
    expect(r.read('f.txt')).toContain('<<<<<<< main\nmain 10\n=======\nother 10\n>>>>>>> other');
    const merging = await r.api.status();
    expect(merging.merging).toBe("Merge branch 'other' into main");
    expect(merging.changes).toEqual([{ path: 'f.txt', code: 'UU' }]);
    await expect(r.api.commit('too early')).rejects.toThrow(/resolve and stage f\.txt/);

    r.write('f.txt', r.read('f.txt').replace(/<<<<<<< main\n(.*)\n=======\n(.*)\n>>>>>>> other\n/, '$1 and $2\n'));
    await r.api.stage(['f.txt']);
    await r.api.commit("Merge branch 'other'");
    expect(r.realGit('log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2);
    expect((await r.api.status()).merging).toBeNull();
    expect(r.realGit('fsck', '--no-dangling')).toBe('');
  });

  it('aborts a conflicted merge', async () => {
    const r = repo();
    await init(r);
    await r.api.createBranch('b');
    r.write('f.txt', 'b\n');
    await r.run(['commit', '-a', '-m', 'b']);
    await r.api.checkout('main');
    r.write('f.txt', 'main\n');
    await r.run(['commit', '-a', '-m', 'main']);
    await r.api.merge('b');
    await r.api.abortMerge();
    expect(r.read('f.txt')).toBe('main\n');
    expect(await r.api.status()).toEqual({ branch: 'main', merging: null, changes: [] });
  });

  it('lists history and what each commit changed', async () => {
    const r = repo();
    await init(r);
    r.write('f.txt', 'replaced\n');
    r.write('n.txt', 'new\n');
    await r.run(['add', '-A']);
    await r.run(['commit', '-m', 'second\n\nwith a body']);
    const log = await r.api.log();
    expect(log.map((c) => c.message)).toEqual(['second\n\nwith a body', 'first']);
    expect(await r.api.commitFiles(log[0].oid)).toEqual([
      { path: 'f.txt', status: 'modified' },
      { path: 'n.txt', status: 'added' },
    ]);
    await expect(r.api.commitFile(log[0].oid, 'n.txt')).resolves.toEqual({ binary: false, before: null, after: 'new\n' });
    await expect(r.api.commitFiles(log[1].oid)).resolves.toEqual([{ path: 'f.txt', status: 'added' }]);
  });

  it('reports binary files without their contents', async () => {
    const r = repo();
    await init(r);
    fs.writeFileSync(path.join(r.dir, 'img.bin'), Buffer.from([0, 1, 2, 0]));
    await expect(r.api.show('img.bin')).resolves.toEqual({ binary: true });
  });
});
