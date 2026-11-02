/**
 * @jest-environment node
 */
/// <reference types="node" />
// Stash, tags, cherry-pick and rebase in the built-in git CLI on the host's
// Node, checked with real git.
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { createGitPro } from './api';

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/git/cli.js');

jest.setTimeout(30000);

// Async, so a test can serve the remote over HTTP from this process.
function cli(dir: string, args: string[], name = 'Test') {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: dir,
      env: { ...process.env, TIDE_GIT_TOKEN: '', TIDE_GIT_NAME: name, TIDE_GIT_EMAIL: `${name.toLowerCase()}@example.com` },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-githist-'));
  const run = (args: string[], name?: string) => cli(dir, args, name);
  // Fails the test on a non-zero exit, with git's message.
  const ok = async (args: string[], name?: string) => {
    const r = await run(args, name);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const exists = (rel: string) => fs.existsSync(path.join(dir, rel));
  const realGit = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  const commitAll = (message: string, name?: string) => ok(['add', '-A']).then(() => ok(['commit', '-m', message], name));
  return { dir, run, ok, write, read, exists, realGit, commitAll, api: createGitPro(run) };
}

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
const edit = (text: string, from: string, to: string) => {
  if (!text.includes(from)) throw new Error(`${from} not found`);
  return text.replace(from, to);
};

async function init() {
  const r = repo();
  await r.ok(['init']);
  r.write('f.txt', lines(20));
  await r.commitAll('first');
  return r;
}

const hasGit = spawnSync('git', ['--version']).status === 0;
const withGit = hasGit ? describe : describe.skip;

withGit('git stash', () => {
  it('stashes tracked, staged and untracked changes so real git can read them, and pops them back', async () => {
    const r = await init();
    r.write('f.txt', edit(r.read('f.txt'), 'line 3\n', 'line three\n'));
    r.write('n.txt', 'new file\n');
    await r.ok(['add', 'n.txt']);
    r.write('u.txt', 'untracked\n');
    expect(await r.ok(['stash', 'push', '-u', '-m', 'my work'])).toContain('Saved working directory and index state On main: my work');
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect(r.exists('n.txt') || r.exists('u.txt')).toBe(false);

    expect(r.realGit('stash', 'list')).toBe('stash@{0}: On main: my work\n');
    const stat = r.realGit('stash', 'show', '--stat', 'stash@{0}');
    expect(stat).toContain('f.txt');
    expect(stat).toContain('n.txt');
    expect(r.realGit('show', 'stash@{0}^3:u.txt')).toBe('untracked\n');
    expect(r.realGit('show', 'stash@{0}^2:n.txt')).toBe('new file\n');
    expect(r.realGit('log', '-1', '--format=%s', 'stash@{0}^2')).toMatch(/^index on main: [0-9a-f]{7} first\n$/);

    r.write('f.txt', edit(r.read('f.txt'), 'line 20\n', 'line twenty\n'));
    await r.ok(['stash']);
    expect(await r.ok(['stash', 'list'])).toMatch(/^stash@\{0\}: WIP on main: [0-9a-f]{7} first\nstash@\{1\}: On main: my work\n$/);
    expect(r.realGit('stash', 'list').split('\n').filter(Boolean)).toHaveLength(2);
    expect(await r.ok(['stash', 'show', '1'])).toContain('n.txt | 1');

    // Pop the older one by index; the newer one stays.
    expect(await r.ok(['stash', 'pop', 'stash@{1}'])).toMatch(/Dropped stash@\{1\}/);
    expect(r.read('f.txt')).toContain('line three\n');
    expect(r.read('n.txt')).toBe('new file\n');
    expect(r.read('u.txt')).toBe('untracked\n');
    // Like real git: changed files come back unstaged, new files staged.
    expect(r.realGit('status', '--porcelain')).toBe(' M f.txt\nA  n.txt\n?? u.txt\n');
    expect(r.realGit('stash', 'list')).toMatch(/^stash@\{0\}: WIP on main/);
    expect(r.realGit('fsck', '--no-dangling')).toBe('');

    await r.ok(['stash', 'drop']);
    expect(r.realGit('stash', 'list')).toBe('');
    expect(fs.existsSync(path.join(r.dir, '.git', 'refs', 'stash'))).toBe(false);
  });

  it('applies a stash made by real git, and real git applies one made here', async () => {
    const r = await init();
    r.write('f.txt', edit(r.read('f.txt'), 'line 1\n', 'real one\n'));
    r.realGit('-c', 'user.name=R', '-c', 'user.email=r@example.com', 'stash', 'push', '-m', 'from real git');
    expect(await r.ok(['stash', 'list'])).toBe('stash@{0}: On main: from real git\n');
    await r.ok(['stash', 'apply']);
    expect(r.read('f.txt').startsWith('real one\n')).toBe(true);
    await r.ok(['stash', 'clear']);
    expect(r.realGit('stash', 'list')).toBe('');

    await r.ok(['stash']);
    expect(r.read('f.txt').startsWith('line 1\n')).toBe(true);
    r.realGit('stash', 'pop');
    expect(r.read('f.txt').startsWith('real one\n')).toBe(true);
    expect(await r.ok(['stash', 'list'])).toBe('');
  });

  it('leaves conflict markers and keeps the stash when popping onto a conflicting change', async () => {
    const r = await init();
    r.write('f.txt', edit(r.read('f.txt'), 'line 5\n', 'stashed 5\n'));
    await r.ok(['stash']);
    r.write('f.txt', edit(r.read('f.txt'), 'line 5\n', 'committed 5\n'));
    await r.commitAll('change 5');
    const popped = await r.run(['stash', 'pop']);
    expect(popped.code).toBe(1);
    expect(popped.stdout).toContain('CONFLICT: merge conflict in f.txt');
    expect(r.read('f.txt')).toContain('<<<<<<< Updated upstream\ncommitted 5\n=======\nstashed 5\n>>>>>>> Stashed changes\n');
    expect(r.realGit('stash', 'list').split('\n').filter(Boolean)).toHaveLength(1);
    expect((await r.api.status()).changes).toEqual([{ path: 'f.txt', code: 'UU' }]);
  });

  it('refuses to apply over local changes to the same file, and says when there is nothing to stash', async () => {
    const r = await init();
    expect(await r.ok(['stash'])).toBe('No local changes to save\n');
    r.write('f.txt', edit(r.read('f.txt'), 'line 2\n', 'two\n'));
    await r.ok(['stash']);
    r.write('f.txt', edit(r.read('f.txt'), 'line 2\n', 'dirty\n'));
    const r2 = await r.run(['stash', 'apply']);
    expect(r2.code).toBe(128);
    expect(r2.stderr).toContain('your local changes to f.txt would be overwritten');
    expect(r.read('f.txt')).toContain('dirty\n');
  });

  it('works through the Git Tools API', async () => {
    const r = await init();
    r.write('f.txt', 'changed\n');
    await expect(r.api.stashPush('wip ✓')).resolves.toMatchObject({ message: 'On main: wip ✓' });
    const list = await r.api.stashes();
    expect(list).toEqual([expect.objectContaining({ index: 0, message: 'On main: wip ✓' })]);
    await expect(r.api.commitFiles(list[0].oid)).resolves.toEqual([{ path: 'f.txt', status: 'modified' }]);
    await expect(r.api.stashApply(0)).resolves.toEqual({ conflicts: [], files: ['f.txt'] });
    expect(r.read('f.txt')).toBe('changed\n');
    await r.api.stashDrop(0);
    await expect(r.api.stashes()).resolves.toEqual([]);
  });
});

withGit('git tag', () => {
  it('creates lightweight and annotated tags real git reads, lists and deletes them', async () => {
    const r = await init();
    r.write('f.txt', 'second\n');
    await r.commitAll('second');
    await r.ok(['tag', 'v1']);
    await r.ok(['tag', '-a', 'v2', '-m', 'Release 2']);
    await r.ok(['tag', 'v0', 'HEAD~1']);
    await r.ok(['tag', '-m', 'implied annotated', 'v3']);
    expect(r.realGit('tag', '-l')).toBe('v0\nv1\nv2\nv3\n');
    expect(r.realGit('cat-file', '-t', 'v1').trim()).toBe('commit');
    expect(r.realGit('cat-file', '-t', 'v2').trim()).toBe('tag');
    expect(r.realGit('cat-file', '-t', 'v3').trim()).toBe('tag');
    expect(r.realGit('for-each-ref', 'refs/tags/v2', '--format=%(contents:subject)|%(taggername)')).toBe('Release 2|Test\n');
    expect(r.realGit('rev-parse', 'v0').trim()).toBe(r.realGit('rev-parse', 'HEAD~1').trim());
    expect(r.realGit('rev-parse', 'v2^{commit}').trim()).toBe(r.realGit('rev-parse', 'HEAD').trim());
    expect(r.realGit('fsck', '--no-dangling')).toBe('');

    expect(await r.ok(['tag'])).toBe('v0\nv1\nv2\nv3\n');
    expect(await r.ok(['tag', '-l', 'v?'])).toBe('v0\nv1\nv2\nv3\n');
    expect(await r.ok(['tag', '-l', 'v2*'])).toBe('v2\n');
    const dup = await r.run(['tag', 'v1']);
    expect(dup.stderr).toContain("tag 'v1' already exists");
    expect(await r.ok(['tag', '-d', 'v1', 'v2'])).toMatch(/Deleted tag 'v1' \(was [0-9a-f]{7}\)\nDeleted tag 'v2'/);
    expect(r.realGit('tag', '-l')).toBe('v0\nv3\n');

    await r.api.createTag('api-light');
    await r.api.createTag('api-note', 'Notes here', 'HEAD~1');
    const tags = await r.api.tags();
    const head = r.realGit('rev-parse', 'HEAD').trim();
    expect(tags.find((t) => t.name === 'api-light')).toEqual({ name: 'api-light', oid: head, annotated: false, message: null });
    expect(tags.find((t) => t.name === 'api-note')).toEqual({ name: 'api-note', oid: r.realGit('rev-parse', 'HEAD~1').trim(), annotated: true, message: 'Notes here' });
    await r.api.deleteTag('api-light');
    expect(r.realGit('tag', '-l', 'api-*')).toBe('api-note\n');
  });

  it('pushes one tag, then the rest with --tags', async () => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-remote-'));
    execFileSync('git', ['init', '--bare', '-q', remoteDir]);
    execFileSync('git', ['config', 'http.receivepack', 'true'], { cwd: remoteDir });
    // Real git's smart HTTP server, as CGI.
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const cgi = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: path.dirname(remoteDir),
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: req.method,
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          REMOTE_USER: 'test',
          REMOTE_ADDR: '127.0.0.1',
          GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
        },
      });
      req.pipe(cgi.stdin);
      const chunks: Buffer[] = [];
      cgi.stdout.on('data', (d) => chunks.push(d));
      cgi.on('close', () => {
        const out = Buffer.concat(chunks);
        const split = out.indexOf('\r\n\r\n');
        const head = out.subarray(0, split).toString('utf8');
        let status = 200;
        for (const line of head.split('\r\n')) {
          const [k, ...v] = line.split(':');
          if (k.toLowerCase() === 'status') status = Number(v.join(':').trim().split(' ')[0]);
          else res.setHeader(k, v.join(':').trim());
        }
        res.statusCode = status;
        res.end(out.subarray(split + 4));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const r = await init();
      await r.ok(['remote', 'add', 'origin', `http://127.0.0.1:${port}/${path.basename(remoteDir)}`]);
      await r.ok(['push', 'origin', 'main']);
      await r.ok(['tag', '-a', 'v1', '-m', 'One']);
      await r.ok(['tag', 'light']);
      expect(await r.ok(['push', 'origin', 'v1'])).toContain('refs/tags/v1: pushed to origin');
      const remoteGit = (...args: string[]) => execFileSync('git', args, { cwd: remoteDir, encoding: 'utf8' });
      expect(remoteGit('tag', '-l')).toBe('v1\n');
      expect(remoteGit('cat-file', '-t', 'v1').trim()).toBe('tag');
      expect(await r.ok(['push', '--tags'])).toBe('light: pushed to origin\n');
      expect(remoteGit('tag', '-l')).toBe('light\nv1\n');
      expect(await r.ok(['push', '--tags'])).toBe('Everything up-to-date\n');
      await r.ok(['tag', 'api']);
      await r.api.pushTag('api');
      expect(remoteGit('tag', '-l')).toBe('api\nlight\nv1\n');
      expect(remoteGit('fsck', '--no-dangling')).toBe('');
    } finally {
      server.close();
    }
  });
});

// main and a feature branch that changed different parts of f.txt.
async function diverged(featureEdits: [string, string][], mainEdit: [string, string] = ['line 20\n', 'main 20\n']) {
  const r = await init();
  await r.ok(['checkout', '-b', 'feature']);
  for (const [i, [from, to]] of featureEdits.entries()) {
    r.write('f.txt', edit(r.read('f.txt'), from, to));
    r.write(`feature${i + 1}.txt`, `feature ${i + 1}\n`);
    await r.commitAll(`feature ${i + 1}`, 'Other');
  }
  await r.ok(['checkout', 'main']);
  r.write('f.txt', edit(r.read('f.txt'), mainEdit[0], mainEdit[1]));
  await r.commitAll('main change');
  return r;
}

withGit('git cherry-pick', () => {
  it('applies a commit onto HEAD with its message and author', async () => {
    const r = await diverged([['line 2\n', 'feature 2\n']]);
    const out = await r.ok(['cherry-pick', 'feature']);
    expect(out).toMatch(/^\[main [0-9a-f]{7}\] feature 1\n$/);
    expect(r.realGit('log', '-1', '--format=%s|%an|%cn|%P')).toBe(`feature 1|Other|Test|${r.realGit('rev-parse', 'HEAD~1').trim()}\n`);
    expect(r.read('f.txt')).toContain('feature 2\n');
    expect(r.read('f.txt')).toContain('main 20\n');
    expect(r.read('feature1.txt')).toBe('feature 1\n');
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect(r.realGit('fsck', '--no-dangling')).toBe('');
    // Again: nothing left to apply.
    const again = await r.run(['cherry-pick', 'feature']);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain('HEAD already has it');
  });

  it('stops on a conflict, then continues once it is resolved and staged', async () => {
    const r = await diverged([['line 20\n', 'feature 20\n']]);
    const short = r.realGit('rev-parse', '--short=7', 'feature').trim();
    const r1 = await r.run(['cherry-pick', 'feature']);
    expect(r1.code).toBe(1);
    expect(r1.stdout).toContain('CONFLICT: merge conflict in f.txt');
    expect(r.read('f.txt')).toContain(`<<<<<<< HEAD\nmain 20\n=======\nfeature 20\n>>>>>>> ${short} (feature 1)\n`);
    // The file the commit added without conflict is staged already.
    expect(r.realGit('status', '--porcelain')).toBe(' M f.txt\nA  feature1.txt\n');
    expect(await r.ok(['status'])).toContain(`You are cherry-picking ${short} (feature 1)`);
    const status = await r.api.status();
    expect(status.operation).toEqual({ kind: 'cherry-pick', current: { oid: r.realGit('rev-parse', 'feature').trim(), subject: 'feature 1' } });
    expect((await r.run(['cherry-pick', '--continue'])).stderr).toContain('resolve and stage f.txt first');
    expect((await r.run(['rebase', 'feature'])).stderr).toContain('a cherry-pick is in progress');

    r.write('f.txt', r.read('f.txt').replace(/<<<<<<< HEAD\n.*\n=======\n.*\n>>>>>>> .*\n/, 'both 20\n'));
    await r.ok(['add', 'f.txt']);
    await r.ok(['cherry-pick', '--continue']);
    expect(r.realGit('log', '-1', '--format=%s|%an')).toBe('feature 1|Other\n');
    expect(r.realGit('show', 'HEAD:f.txt')).toContain('both 20\n');
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(r.dir, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
    expect((await r.api.status()).operation).toBeNull();
  });

  it('aborts a conflicted cherry-pick back to how HEAD was', async () => {
    const r = await diverged([['line 20\n', 'feature 20\n']]);
    const before = r.realGit('rev-parse', 'HEAD').trim();
    await r.api.cherryPick('feature').then((x) => expect(x).toMatchObject({ status: 'conflict', conflicts: ['f.txt'] }));
    await r.api.cherryPickAbort();
    expect(r.realGit('rev-parse', 'HEAD').trim()).toBe(before);
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect(r.exists('feature1.txt')).toBe(false);
    expect((await r.api.status()).operation).toBeNull();
  });

  it('refuses when the commit would overwrite local changes', async () => {
    const r = await diverged([['line 2\n', 'feature 2\n']]);
    r.write('f.txt', edit(r.read('f.txt'), 'line 2\n', 'dirty 2\n'));
    const res = await r.run(['cherry-pick', 'feature']);
    expect(res.stderr).toContain('your local changes to f.txt would be overwritten');
    expect(r.read('f.txt')).toContain('dirty 2\n');
  });
});

withGit('git rebase', () => {
  it('replays the branch onto upstream, keeping messages and authors', async () => {
    const r = await diverged([
      ['line 2\n', 'feature 2\n'],
      ['line 4\n', 'feature 4\n'],
    ]);
    await r.ok(['checkout', 'feature']);
    expect(await r.ok(['rebase', 'main'])).toBe('Successfully rebased and updated refs/heads/feature.\n');
    expect(r.realGit('log', '--format=%s|%an', 'main..feature')).toBe('feature 2|Other\nfeature 1|Other\n');
    expect(r.realGit('merge-base', 'main', 'feature').trim()).toBe(r.realGit('rev-parse', 'main').trim());
    expect(r.read('f.txt')).toContain('feature 2\n');
    expect(r.read('f.txt')).toContain('feature 4\n');
    expect(r.read('f.txt')).toContain('main 20\n');
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(r.dir, '.git', 'rebase-merge'))).toBe(false);
    expect(r.realGit('fsck', '--no-dangling')).toBe('');
    expect(await r.ok(['rebase', 'main'])).toBe('Current branch feature is up to date.\n');
  });

  it('fast-forwards when the branch has nothing of its own', async () => {
    const r = await diverged([['line 2\n', 'feature 2\n']]);
    await r.ok(['checkout', '-b', 'behind']);
    r.realGit('reset', '-q', '--hard', 'HEAD~1');
    expect(await r.ok(['rebase', 'main'])).toBe('Fast-forwarded behind to main.\n');
    expect(r.realGit('rev-parse', 'behind').trim()).toBe(r.realGit('rev-parse', 'main').trim());
    expect(r.read('f.txt')).toContain('main 20\n');
  });

  it('stops on a conflict and continues, with its state in .git between runs', async () => {
    const r = await diverged([
      ['line 2\n', 'feature 2\n'],
      ['line 20\n', 'feature 20\n'],
      ['line 6\n', 'feature 6\n'],
    ]);
    await r.ok(['checkout', 'feature']);
    const stop = await r.run(['rebase', 'main']);
    expect(stop.code).toBe(1);
    expect(stop.stdout).toMatch(/could not apply [0-9a-f]{7}\.\.\. feature 2/);
    expect(r.read('f.txt')).toMatch(/<<<<<<< HEAD\nmain 20\n=======\nfeature 20\n>>>>>>> [0-9a-f]{7} \(feature 2\)\n/);
    expect(fs.readFileSync(path.join(r.dir, '.git', 'rebase-merge', 'head-name'), 'utf8')).toBe('refs/heads/feature\n');
    expect(await r.ok(['status'])).toMatch(/You are rebasing feature onto [0-9a-f]{7} \(2\/3 applied\)/);
    const op = (await r.api.status()).operation;
    expect(op).toMatchObject({ kind: 'rebase', branch: 'feature', step: 2, total: 3, current: { subject: 'feature 2' } });
    expect((await r.run(['rebase', '--continue'])).stderr).toContain('resolve and stage f.txt first');

    r.write('f.txt', r.read('f.txt').replace(/<<<<<<< HEAD\n.*\n=======\n.*\n>>>>>>> .*\n/, 'merged 20\n'));
    await r.ok(['add', 'f.txt']);
    expect(await r.ok(['rebase', '--continue'])).toBe('Successfully rebased and updated refs/heads/feature.\n');
    expect(r.realGit('log', '--format=%s', 'main..feature')).toBe('feature 3\nfeature 2\nfeature 1\n');
    expect(r.realGit('show', 'feature:f.txt')).toContain('merged 20\n');
    expect(r.realGit('show', 'feature:f.txt')).toContain('feature 6\n');
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect((await r.api.status()).operation).toBeNull();
  });

  it('skips the conflicting commit', async () => {
    const r = await diverged([
      ['line 20\n', 'feature 20\n'],
      ['line 6\n', 'feature 6\n'],
    ]);
    await r.ok(['checkout', 'feature']);
    await expect(r.api.rebase('main')).resolves.toMatchObject({ status: 'conflict', conflicts: ['f.txt'], step: 1, total: 2 });
    await expect(r.api.rebaseSkip()).resolves.toMatchObject({ status: 'done', skipped: [{ subject: 'feature 1' }] });
    expect(r.realGit('log', '--format=%s', 'main..feature')).toBe('feature 2\n');
    expect(r.read('f.txt')).toContain('main 20\n');
    expect(r.read('f.txt')).toContain('feature 6\n');
    expect(r.exists('feature1.txt')).toBe(false);
    expect(r.realGit('status', '--porcelain')).toBe('');
  });

  it('aborts back to the original branch and files', async () => {
    const r = await diverged([
      ['line 2\n', 'feature 2\n'],
      ['line 20\n', 'feature 20\n'],
    ]);
    await r.ok(['checkout', 'feature']);
    const orig = r.realGit('rev-parse', 'feature').trim();
    expect((await r.run(['rebase', 'main'])).code).toBe(1);
    await r.ok(['rebase', '--abort']);
    expect(r.realGit('rev-parse', 'feature').trim()).toBe(orig);
    expect(r.realGit('symbolic-ref', 'HEAD').trim()).toBe('refs/heads/feature');
    expect(r.realGit('status', '--porcelain')).toBe('');
    expect(r.read('f.txt')).toContain('feature 20\n');
    expect(r.read('f.txt')).not.toContain('main 20');
    expect(fs.existsSync(path.join(r.dir, '.git', 'rebase-merge'))).toBe(false);
  });

  it('refuses with uncommitted changes and unsupported options', async () => {
    const r = await diverged([['line 2\n', 'feature 2\n']]);
    await r.ok(['checkout', 'feature']);
    expect((await r.run(['rebase', '-i', 'main'])).stderr).toContain('interactive rebase');
    r.write('f.txt', 'dirty\n');
    expect((await r.run(['rebase', 'main'])).stderr).toContain('commit or stash your changes');
  });
});
