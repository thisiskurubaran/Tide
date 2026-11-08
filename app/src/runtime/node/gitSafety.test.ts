/**
 * @jest-environment node
 */
/// <reference types="node" />
// The built-in git CLI must never lose work real git would keep: checkout,
// pull, rm, stash, rebase and Git Pro's merge refuse instead of overwriting,
// and credentials only go where they belong. Checked with real git.
import { execFile, execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createAuth, hostOf } = require('../../../nodejs-assets/nodejs-project/git/auth');
/* eslint-enable @typescript-eslint/no-require-imports */

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/git/cli.js');
const run = promisify(execFile);

const ENV = { TIDE_GIT_TOKEN: '', TIDE_GIT_HOSTS: '', TIDE_GIT_NAME: 'Test', TIDE_GIT_EMAIL: 't@example.com' };

// Async, so an http server in this process can answer it.
async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...ENV, ...env }, encoding: 'utf8' });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, out: err.stdout + err.stderr };
  }
}

const real = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Real', '-c', 'user.email=r@example.com', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tide-gitsafe-'));
const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');

/** A repo on main with f.txt and same.txt committed, and a branch `other` where f.txt differs. */
async function twoBranches() {
  const dir = tmp();
  await git(dir, ['init']);
  write(dir, 'f.txt', 'base\n');
  write(dir, 'same.txt', 'same\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'base']);
  await git(dir, ['branch', 'other']);
  write(dir, 'f.txt', 'main\n');
  await git(dir, ['commit', '-am', 'main']);
  return dir;
}

// Smart HTTP over `git http-backend`, the way a real git host serves it.
function gitServer(root: string) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const child = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        REQUEST_METHOD: req.method ?? 'GET',
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}),
      },
    });
    req.pipe(child.stdin);
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', () => {
      const out = Buffer.concat(chunks);
      const split = out.indexOf('\r\n\r\n');
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of out.subarray(0, split).toString('utf8').split('\r\n')) {
        const i = line.indexOf(':');
        const [k, v] = [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        if (k.toLowerCase() === 'status') status = Number(v.split(' ')[0]);
        else if (k) headers[k] = v;
      }
      res.writeHead(status, headers);
      res.end(out.subarray(split + 4));
    });
  });
  return new Promise<{ url: string; close(): void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })),
  );
}

const hasGit = spawnSync('git', ['--version']).status === 0;
const withGit = hasGit ? describe : describe.skip;

withGit('checkout keeps local changes', () => {
  it('refuses to switch when a file the switch changes has a staged edit', async () => {
    const dir = await twoBranches();
    write(dir, 'f.txt', 'my staged work\n');
    await git(dir, ['add', 'f.txt']);
    const r = await git(dir, ['checkout', 'other']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/Your local changes to the following files would be overwritten by checkout:\n\tf\.txt\nPlease commit your changes or stash them/);
    expect(read(dir, 'f.txt')).toBe('my staged work\n');
    expect(real(dir, 'status', '--porcelain')).toBe('M  f.txt\n');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\n');
  });

  it('refuses to overwrite an untracked file the target tracks', async () => {
    const dir = await twoBranches();
    await git(dir, ['checkout', 'other']);
    write(dir, 'new.txt', 'tracked on other\n');
    await git(dir, ['add', 'new.txt']);
    await git(dir, ['commit', '-m', 'add new']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'new.txt', 'my untracked notes\n');
    const r = await git(dir, ['checkout', 'other']);
    expect(r.out).toMatch(/untracked working tree files would be overwritten by checkout:\n\tnew\.txt/);
    expect(read(dir, 'new.txt')).toBe('my untracked notes\n');
  });

  it('carries staged and unstaged edits to files both branches share', async () => {
    const dir = await twoBranches();
    write(dir, 'same.txt', 'staged\n');
    await git(dir, ['add', 'same.txt']);
    expect((await git(dir, ['checkout', 'other'])).code).toBe(0);
    expect(read(dir, 'f.txt')).toBe('base\n');
    expect(read(dir, 'same.txt')).toBe('staged\n');
    expect(real(dir, 'status', '--porcelain')).toBe('M  same.txt\n');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other\n');
  });

  it('refuses the same way from Git Pro', async () => {
    const dir = await twoBranches();
    write(dir, 'f.txt', 'my staged work\n');
    await git(dir, ['add', 'f.txt']);
    expect((await git(dir, ['__tide', 'checkout', 'other'])).out).toMatch(/would be overwritten by checkout/);
    expect(read(dir, 'f.txt')).toBe('my staged work\n');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\n');
  });
});

withGit('pull', () => {
  let server: { url: string; close(): void };
  let root: string;
  beforeAll(async () => {
    root = tmp();
    server = await gitServer(root);
  });
  afterAll(() => server.close());

  /** A bare remote with one commit, a clone of it, and a second clone to push from. */
  function setup(name: string) {
    const seed = tmp();
    real(seed, 'init', '-q');
    write(seed, 'f.txt', 'one\n');
    write(seed, 'g.txt', 'g\n');
    real(seed, 'add', '-A');
    real(seed, 'commit', '-qm', 'one');
    real(root, 'clone', '-q', '--bare', seed, `${name}.git`);
    const local = tmp();
    real(local, 'clone', '-q', path.join(root, `${name}.git`), '.');
    real(local, 'remote', 'set-url', 'origin', `${server.url}/${name}.git`);
    const pushFrom = tmp();
    real(pushFrom, 'clone', '-q', path.join(root, `${name}.git`), '.');
    return { local, pushFrom };
  }

  it('refuses before moving the branch when the pulled commit would overwrite a staged edit', async () => {
    const { local, pushFrom } = setup('staged');
    write(pushFrom, 'f.txt', 'two\n');
    real(pushFrom, 'commit', '-qam', 'two');
    real(pushFrom, 'push', '-q', 'origin', 'main');
    const before = real(local, 'rev-parse', 'HEAD');
    write(local, 'f.txt', 'my staged work\n');
    real(local, 'add', 'f.txt');

    const r = await git(local, ['pull']);
    expect(r.out).toMatch(/Your local changes to the following files would be overwritten by merge:\n\tf\.txt/);
    expect(real(local, 'rev-parse', 'HEAD')).toBe(before);
    expect(read(local, 'f.txt')).toBe('my staged work\n');
    expect(real(local, 'status', '--porcelain')).toBe('M  f.txt\n');
  });

  it('fast-forwards, and merges diverged history, keeping unrelated local edits', async () => {
    const { local, pushFrom } = setup('ff');
    write(pushFrom, 'f.txt', 'two\n');
    real(pushFrom, 'commit', '-qam', 'two');
    real(pushFrom, 'push', '-q', 'origin', 'main');
    write(local, 'g.txt', 'local edit\n');
    const ff = await git(local, ['pull']);
    expect(ff.out).toMatch(/Fast-forward/);
    expect(real(local, 'rev-parse', 'HEAD')).toBe(real(pushFrom, 'rev-parse', 'HEAD'));
    expect(read(local, 'f.txt')).toBe('two\n');
    expect(real(local, 'status', '--porcelain')).toBe(' M g.txt\n');

    real(local, 'checkout', '-q', 'g.txt');
    write(local, 'h.txt', 'h\n');
    real(local, 'add', 'h.txt');
    real(local, 'commit', '-qm', 'local');
    write(pushFrom, 'f.txt', 'three\n');
    real(pushFrom, 'commit', '-qam', 'three');
    real(pushFrom, 'push', '-q', 'origin', 'main');
    const merged = await git(local, ['pull']);
    expect(merged.out).toMatch(/Merge made/);
    expect(real(local, 'log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2);
    expect(read(local, 'f.txt')).toBe('three\n');
    expect(read(local, 'h.txt')).toBe('h\n');
    expect(real(local, 'status', '--porcelain')).toBe('');
  });

  it('pulls across a file that became a folder, and back', async () => {
    const { local, pushFrom } = setup('typechange');
    real(pushFrom, 'rm', '-q', 'g.txt');
    write(pushFrom, 'g.txt/inner.txt', 'inner\n');
    real(pushFrom, 'add', '-A');
    real(pushFrom, 'commit', '-qm', 'folder');
    real(pushFrom, 'push', '-q', 'origin', 'main');
    const r = await git(local, ['pull']);
    expect(r.out).toMatch(/Fast-forward/);
    expect(read(local, 'g.txt/inner.txt')).toBe('inner\n');
    expect(real(local, 'status', '--porcelain')).toBe('');

    real(pushFrom, 'rm', '-rq', 'g.txt');
    write(pushFrom, 'g.txt', 'file again\n');
    real(pushFrom, 'add', '-A');
    real(pushFrom, 'commit', '-qm', 'file');
    real(pushFrom, 'push', '-q', 'origin', 'main');
    expect((await git(local, ['pull'])).code).toBe(0);
    expect(read(local, 'g.txt')).toBe('file again\n');
    expect(real(local, 'status', '--porcelain')).toBe('');
  });

  it("pulls from the branch's configured remote, not always origin", async () => {
    const { local, pushFrom } = setup('upremote');
    real(local, 'remote', 'rename', 'origin', 'up');
    real(local, 'remote', 'add', 'origin', `${server.url}/nothing-here.git`);
    expect(real(local, 'config', 'branch.main.remote')).toBe('up\n');
    write(pushFrom, 'f.txt', 'two\n');
    real(pushFrom, 'commit', '-qam', 'two');
    real(pushFrom, 'push', '-q', 'origin', 'main');
    const r = await git(local, ['pull']);
    expect(r.code).toBe(0);
    expect(real(local, 'rev-parse', 'HEAD')).toBe(real(pushFrom, 'rev-parse', 'HEAD'));
  });

  it('explains a branch with no upstream, and an unborn branch whose remote default is named differently', async () => {
    const { local } = setup('noupstream');
    real(local, 'checkout', '-qb', 'topic');
    const r = await git(local, ['pull']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/There is no tracking information for the current branch\.\nPlease specify which branch you want to merge with\./);
    // push -u sets the upstream, after which pull knows where to pull from.
    real(path.join(root, 'noupstream.git'), 'config', 'http.receivepack', 'true');
    expect((await git(local, ['push', '-u', 'origin', 'topic'])).out).toMatch(/branch 'topic' set up to track 'origin\/topic'/);
    expect(real(local, 'config', 'branch.topic.merge')).toBe('refs/heads/topic\n');
    expect((await git(local, ['pull'])).out).toMatch(/Already up to date/);

    const empty = tmp();
    real(empty, 'init', '-q', '-b', 'master');
    real(empty, 'remote', 'add', 'origin', `${server.url}/noupstream.git`);
    const unborn = await git(empty, ['pull']);
    expect(unborn.code).toBe(128);
    expect(unborn.out).toMatch(/your branch 'master' has no commits yet, and origin's default branch is 'main', not 'master'/);
    expect(unborn.out).toMatch(/git pull origin main/);
    expect((await git(empty, ['pull', 'origin', 'main'])).code).toBe(0);
    expect(read(empty, 'f.txt')).toBe('one\n');
    expect(real(empty, 'status', '--porcelain')).toBe('');
  });
});

withGit('rm', () => {
  async function repo() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a.txt', 'a\n');
    write(dir, 'src/b.js', 'b\n');
    write(dir, 'src/c.js', 'c\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    return dir;
  }

  it('refuses a file with local modifications unless forced', async () => {
    const dir = await repo();
    write(dir, 'a.txt', 'edited\n');
    const r = await git(dir, ['rm', 'a.txt']);
    expect(r.out).toMatch(/the following file has local modifications:\n {4}a\.txt/);
    expect(read(dir, 'a.txt')).toBe('edited\n');
    expect(real(dir, 'status', '--porcelain')).toBe(' M a.txt\n');
    write(dir, 'src/b.js', 'staged\n');
    await git(dir, ['add', 'src/b.js']);
    expect((await git(dir, ['rm', '-r', 'src'])).out).toMatch(/changes staged in the index/);
    expect(read(dir, 'src/b.js')).toBe('staged\n');
    expect((await git(dir, ['rm', '-f', 'a.txt'])).code).toBe(0);
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(false);
  });

  it('needs -r for a folder and leaves untracked files in it', async () => {
    const dir = await repo();
    write(dir, 'src/notes.txt', 'untracked\n');
    expect((await git(dir, ['rm', 'src'])).out).toMatch(/not removing 'src' recursively without -r/);
    expect(fs.existsSync(path.join(dir, 'src/b.js'))).toBe(true);
    expect((await git(dir, ['rm', '-r', 'src'])).code).toBe(0);
    expect(fs.readdirSync(path.join(dir, 'src'))).toEqual(['notes.txt']);
    expect(real(dir, 'status', '--porcelain', '-uall')).toBe('D  src/b.js\nD  src/c.js\n?? src/notes.txt\n');
  });

  it('rm -r . removes only tracked files, never .git or untracked files', async () => {
    const dir = await repo();
    write(dir, 'untracked.txt', 'keep me\n');
    expect((await git(dir, ['rm', '-r', '.'])).code).toBe(0);
    expect(fs.readdirSync(dir).sort()).toEqual(['.git', 'untracked.txt']);
    expect(real(dir, 'status', '--porcelain')).toBe('D  a.txt\nD  src/b.js\nD  src/c.js\n?? untracked.txt\n');
  });

  it('--cached keeps the file', async () => {
    const dir = await repo();
    write(dir, 'a.txt', 'edited\n');
    expect((await git(dir, ['rm', '--cached', 'a.txt'])).code).toBe(0);
    expect(read(dir, 'a.txt')).toBe('edited\n');
    expect(real(dir, 'status', '--porcelain')).toBe('D  a.txt\n?? a.txt\n');
  });
});

withGit('stash', () => {
  for (const via of ['cli', 'Git Pro']) {
    it(`keeps edits to a file removed with rm --cached (${via})`, async () => {
      const dir = tmp();
      await git(dir, ['init']);
      write(dir, 'cfg.json', 'committed\n');
      write(dir, 'f.txt', 'f\n');
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-m', 'base']);
      await git(dir, ['rm', '--cached', 'cfg.json']);
      write(dir, 'cfg.json', 'my edit\n');
      const pushed = via === 'cli' ? await git(dir, ['stash']) : await git(dir, ['__tide', 'stash-push', '', '0']);
      expect(pushed.code).toBe(0);
      expect(real(dir, 'show', 'stash@{0}:cfg.json')).toBe('my edit\n');
      expect(read(dir, 'cfg.json')).toBe('committed\n');
      expect((await git(dir, ['stash', 'pop'])).code).toBe(0);
      expect(read(dir, 'cfg.json')).toBe('my edit\n');
    });
  }
});

withGit('rebase and merge with untracked files in the way', () => {
  async function repo() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a', '1\n');
    await git(dir, ['add', 'a']);
    await git(dir, ['commit', '-m', '1']);
    await git(dir, ['branch', 'up']);
    write(dir, 'b', '2\n');
    await git(dir, ['add', 'b']);
    await git(dir, ['commit', '-m', '2']);
    await git(dir, ['checkout', 'up']);
    write(dir, 'env', 'upstream\n');
    await git(dir, ['add', 'env']);
    await git(dir, ['commit', '-m', 'up']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'env', 'MY LOCAL ENV\n');
    return dir;
  }

  it('rebase refuses before touching anything', async () => {
    const dir = await repo();
    const before = real(dir, 'rev-parse', 'HEAD');
    const r = await git(dir, ['rebase', 'up']);
    expect(r.out).toMatch(/The following untracked working tree files would be overwritten by checkout:\n\tenv/);
    expect(read(dir, 'env')).toBe('MY LOCAL ENV\n');
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(fs.existsSync(path.join(dir, '.git', 'rebase-merge'))).toBe(false);
  });

  it('Git Pro merge refuses before touching anything', async () => {
    const dir = await repo();
    const before = real(dir, 'rev-parse', 'HEAD');
    const r = await git(dir, ['__tide', 'merge', 'up']);
    expect(r.out).toMatch(/The following untracked working tree files would be overwritten by merge:\n\tenv/);
    expect(read(dir, 'env')).toBe('MY LOCAL ENV\n');
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(before);
  });
});

withGit('Git Pro merge with conflicts keeps the other branch', () => {
  // feat edits a.txt and c.txt, adds n.txt and deletes d.txt; main edits a.txt.
  async function conflicted() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a.txt', 'a\n');
    write(dir, 'c.txt', 'c\n');
    write(dir, 'd.txt', 'd\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'feat']);
    await git(dir, ['checkout', 'feat']);
    write(dir, 'a.txt', 'feat\n');
    write(dir, 'c.txt', 'c2\n');
    write(dir, 'n.txt', 'n\n');
    await git(dir, ['rm', '-q', 'd.txt']);
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'feat']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'a.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    const r = await git(dir, ['__tide', 'merge', 'feat']);
    expect(JSON.parse(r.out).conflicts).toEqual(['a.txt']);
    return dir;
  }

  it('stages their changes, additions and deletions, leaving only the conflict unmerged', async () => {
    const dir = await conflicted();
    expect(real(dir, 'status', '--porcelain')).toBe('UU a.txt\nM  c.txt\nD  d.txt\nA  n.txt\n');
    expect(fs.existsSync(path.join(dir, 'd.txt'))).toBe(false);
  });

  it.each(['cli', 'gitpro'])('the merge commit has every change from the merged branch (%s commit)', async (via) => {
    const dir = await conflicted();
    write(dir, 'a.txt', 'resolved\n');
    await git(dir, ['add', 'a.txt']);
    const r = via === 'cli' ? await git(dir, ['commit', '-m', 'merge']) : await git(dir, ['__tide', 'commit', Buffer.from('merge').toString('base64')]);
    expect(r.code).toBe(0);
    expect(real(dir, 'log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2);
    expect(real(dir, 'ls-tree', '--name-only', 'HEAD')).toBe('a.txt\nc.txt\nn.txt\n');
    expect(real(dir, 'show', 'HEAD:c.txt')).toBe('c2\n');
    expect(real(dir, 'show', 'HEAD:a.txt')).toBe('resolved\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.git', 'TIDE_CONFLICTS'))).toBe(false);
  });

  it('CLI commit, even with -a, refuses while a conflict is unresolved', async () => {
    const dir = await conflicted();
    const before = real(dir, 'rev-parse', 'HEAD');
    const r = await git(dir, ['commit', '-am', 'oops']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/unmerged files: a\.txt/);
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('abort puts everything back to HEAD, removing the files the merge added', async () => {
    const dir = await conflicted();
    write(dir, 'mine.txt', 'untracked\n');
    expect((await git(dir, ['__tide', 'abort-merge'])).code).toBe(0);
    expect(real(dir, 'status', '--porcelain')).toBe('?? mine.txt\n');
    expect(read(dir, 'a.txt')).toBe('main\n');
    expect(read(dir, 'd.txt')).toBe('d\n');
    expect(fs.existsSync(path.join(dir, 'n.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
  });
});

withGit('tracked symlinks', () => {
  // A link to a folder and a link to a file, committed; the index is written
  // in the same second, so the racy-file recheck looks at both links.
  async function linked() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'lib/x.txt', 'x\n');
    write(dir, 't.txt', 't\n');
    fs.symlinkSync('lib', path.join(dir, 'lib-link'));
    fs.symlinkSync('t.txt', path.join(dir, 't-link'));
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    expect(real(dir, 'ls-files', '-s', 'lib-link', 't-link')).toMatch(/^120000 .*\tlib-link\n120000 .*\tt-link\n$/);
    // Newer than the index: racy.
    const later = new Date(Date.now() + 5000);
    fs.lutimesSync(path.join(dir, 'lib-link'), later, later);
    fs.lutimesSync(path.join(dir, 't-link'), later, later);
    return dir;
  }

  it('status works with a link to a folder', async () => {
    const dir = await linked();
    const r = await git(dir, ['status', '-s']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it("a link isn't modified when its target changes", async () => {
    const dir = await linked();
    write(dir, 't.txt', 'changed\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 't.txt'), later, later);
    expect((await git(dir, ['status', '-s'])).out).toBe(' M t.txt\n');
    expect(real(dir, 'status', '--porcelain')).toBe(' M t.txt\n');
  });

  it('commit -a, stash and checkout work with the links in place', async () => {
    const dir = await linked();
    await git(dir, ['branch', 'other']);
    write(dir, 'lib/x.txt', 'x2\n');
    expect((await git(dir, ['stash'])).code).toBe(0);
    expect(read(dir, 'lib/x.txt')).toBe('x\n');
    expect((await git(dir, ['stash', 'pop'])).code).toBe(0);
    expect((await git(dir, ['commit', '-am', 'x2'])).code).toBe(0);
    expect(real(dir, 'show', '--name-only', '--format=', 'HEAD')).toBe('lib/x.txt\n');
    expect((await git(dir, ['checkout', 'other'])).code).toBe(0);
    expect(read(dir, 'lib-link/x.txt')).toBe('x\n');
    expect(fs.readlinkSync(path.join(dir, 't-link'))).toBe('t.txt');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });
});

withGit('switching across a file that became a folder', () => {
  /** main has x as a file; other has x/y instead. */
  async function typeChange() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'x', 'file\n');
    write(dir, 'keep', 'k\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'other']);
    await git(dir, ['checkout', 'other']);
    await git(dir, ['rm', '-q', 'x']);
    write(dir, 'x/y', 'inside\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'folder']);
    return dir;
  }

  it('checks out both ways', async () => {
    const dir = await typeChange();
    expect((await git(dir, ['checkout', 'main'])).code).toBe(0);
    expect(read(dir, 'x')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
    const r = await git(dir, ['checkout', 'other']);
    expect(r.out).not.toMatch(/ENOTDIR/);
    expect(r.code).toBe(0);
    expect(read(dir, 'x/y')).toBe('inside\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other\n');
  });

  it('still refuses when what is in the way has local changes or untracked files', async () => {
    const dir = await typeChange();
    write(dir, 'x/y', 'my edit\n');
    expect((await git(dir, ['checkout', 'main'])).out).toMatch(/local changes to the following files would be overwritten by checkout:\n\tx\/y/);
    expect(read(dir, 'x/y')).toBe('my edit\n');
    real(dir, 'checkout', '--', 'x/y');
    write(dir, 'x/notes', 'untracked\n');
    expect((await git(dir, ['checkout', 'main'])).out).toMatch(/untracked working tree files would be overwritten by checkout:\n\tx\/notes/);
    expect(read(dir, 'x/notes')).toBe('untracked\n');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other\n');
  });
});

withGit('changes that already match the target', () => {
  it('checkout allows a staged deletion the target branch also has', async () => {
    const dir = await twoBranches();
    await git(dir, ['checkout', 'other']);
    await git(dir, ['rm', '-q', 'same.txt']);
    await git(dir, ['commit', '-m', 'drop same']);
    await git(dir, ['checkout', 'main']);
    await git(dir, ['rm', '-q', 'same.txt']);
    const r = await git(dir, ['checkout', 'other']);
    expect(r.code).toBe(0);
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('checkout allows a staged edit equal to the target, and still refuses a different one', async () => {
    const dir = await twoBranches();
    write(dir, 'f.txt', 'base\n');
    await git(dir, ['add', 'f.txt']);
    expect((await git(dir, ['checkout', 'other'])).code).toBe(0);
    expect(real(dir, 'status', '--porcelain')).toBe('');
    await git(dir, ['checkout', 'main']);
    write(dir, 'f.txt', 'base\n');
    await git(dir, ['add', 'f.txt']);
    write(dir, 'f.txt', 'unstaged on top\n');
    expect((await git(dir, ['checkout', 'other'])).out).toMatch(/would be overwritten by checkout:\n\tf\.txt/);
  });

  it("Git Pro merge isn't blocked by an untracked file at a path the merge doesn't touch", async () => {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a', 'a\n');
    write(dir, 'old', 'old\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'feat']);
    // main deletes old; feat leaves it alone and changes a.
    await git(dir, ['rm', '-q', 'old']);
    await git(dir, ['commit', '-m', 'drop old']);
    await git(dir, ['checkout', 'feat']);
    write(dir, 'a', 'feat\n');
    await git(dir, ['commit', '-am', 'feat']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'old', 'my untracked notes\n');
    const r = await git(dir, ['__tide', 'merge', 'feat']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).conflicts).toEqual([]);
    expect(read(dir, 'old')).toBe('my untracked notes\n');
    expect(read(dir, 'a')).toBe('feat\n');
    expect(real(dir, 'status', '--porcelain')).toBe('?? old\n');
  });
});

withGit('pull and checkout during a merge, rebase or cherry-pick', () => {
  /** A Git Pro merge of feat into main that stopped with a.txt conflicted. */
  async function merging() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a.txt', 'a\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'feat']);
    await git(dir, ['checkout', 'feat']);
    write(dir, 'a.txt', 'feat\n');
    await git(dir, ['commit', '-am', 'feat']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'a.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    await git(dir, ['branch', 'side']);
    expect(JSON.parse((await git(dir, ['__tide', 'merge', 'feat'])).out).conflicts).toEqual(['a.txt']);
    return dir;
  }

  it('refuses with unmerged files, then while MERGE_HEAD exists', async () => {
    const dir = await merging();
    const pull = await git(dir, ['pull', 'origin', 'main']);
    expect(pull.code).toBe(128);
    expect(pull.out).toMatch(/Pulling is not possible because you have unmerged files:\n\ta\.txt/);
    expect((await git(dir, ['checkout', 'side'])).out).toMatch(/you need to resolve your current index first\na\.txt: needs merge/);
    expect((await git(dir, ['__tide', 'checkout', 'side'])).out).toMatch(/needs merge/);

    write(dir, 'a.txt', 'resolved\n');
    await git(dir, ['add', 'a.txt']);
    expect((await git(dir, ['pull', 'origin', 'main'])).out).toMatch(/You have not concluded your merge \(MERGE_HEAD exists\)\./);
    expect((await git(dir, ['checkout', 'side'])).out).toMatch(/cannot switch branch while merging/);
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\n');
    expect(read(dir, 'a.txt')).toBe('resolved\n');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
  });

  it('refuses during a cherry-pick or rebase', async () => {
    const dir = await twoBranches();
    fs.writeFileSync(path.join(dir, '.git', 'CHERRY_PICK_HEAD'), `${real(dir, 'rev-parse', 'other')}`);
    expect((await git(dir, ['pull', 'origin', 'main'])).out).toMatch(/You have not concluded your cherry-pick \(CHERRY_PICK_HEAD exists\)/);
    expect((await git(dir, ['checkout', 'other'])).out).toMatch(/cannot switch branch while cherry-picking/);
    fs.rmSync(path.join(dir, '.git', 'CHERRY_PICK_HEAD'));
    fs.mkdirSync(path.join(dir, '.git', 'rebase-merge'));
    fs.writeFileSync(path.join(dir, '.git', 'rebase-merge', 'head-name'), 'refs/heads/main\n');
    expect((await git(dir, ['checkout', 'other'])).out).toMatch(/cannot switch branch while rebasing/);
    expect((await git(dir, ['pull', 'origin', 'main'])).out).toMatch(/rebase is in progress/);
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\n');
  });
});

withGit('rm options', () => {
  async function repo() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a.log', 'a\n');
    write(dir, 'keep.txt', 'k\n');
    write(dir, 'src/b.log', 'b\n');
    write(dir, 'src/deep/c.log', 'c\n');
    write(dir, 'src/d.js', 'd\n');
    write(dir, '-weird', 'w\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    write(dir, 'u.log', 'untracked\n');
    return dir;
  }

  it("removes tracked files matching a glob, in every folder, as git's pathspec does", async () => {
    const dir = await repo();
    const r = await git(dir, ['rm', '-q', '*.log']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(real(dir, 'status', '--porcelain')).toBe('D  a.log\nD  src/b.log\nD  src/deep/c.log\n?? u.log\n');
    expect(read(dir, 'u.log')).toBe('untracked\n');
  });

  it('globs from a subfolder match below it only', async () => {
    const dir = await repo();
    expect((await git(path.join(dir, 'src'), ['rm', 'deep/*.log'])).out).toBe("rm 'src/deep/c.log'\n");
    expect((await git(path.join(dir, 'src'), ['rm', '--cached', '[bd].*'])).out).toBe("rm 'src/b.log'\nrm 'src/d.js'\n");
    expect(real(dir, 'status', '--porcelain', '-uall')).toBe('D  src/b.log\nD  src/d.js\nD  src/deep/c.log\n?? src/b.log\n?? src/d.js\n?? u.log\n');
  });

  it('-n and --dry-run only list, -- ends the options, and --recursive is -r', async () => {
    const dir = await repo();
    expect((await git(dir, ['rm', '-n', '*.log'])).out).toBe("rm 'a.log'\nrm 'src/b.log'\nrm 'src/deep/c.log'\n");
    expect((await git(dir, ['rm', '--dry-run', '-r', 'src'])).code).toBe(0);
    expect(real(dir, 'status', '--porcelain')).toBe('?? u.log\n');
    expect((await git(dir, ['rm', '--', '-weird'])).out).toBe("rm '-weird'\n");
    expect((await git(dir, ['rm', '--recursive', '-q', 'src'])).code).toBe(0);
    expect(real(dir, 'status', '--porcelain')).toBe('D  -weird\nD  src/b.log\nD  src/d.js\nD  src/deep/c.log\n?? u.log\n');
    expect((await git(dir, ['rm', 'nope*'])).out).toMatch(/pathspec 'nope\*' did not match any files/);
  });

  it('resolves a merge conflict by deletion', async () => {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a.txt', 'a\n');
    write(dir, 'b.txt', 'b\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'feat']);
    await git(dir, ['checkout', 'feat']);
    write(dir, 'a.txt', 'feat\n');
    await git(dir, ['commit', '-am', 'feat']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'a.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    expect(JSON.parse((await git(dir, ['__tide', 'merge', 'feat'])).out).conflicts).toEqual(['a.txt']);
    expect((await git(dir, ['rm', 'a.txt'])).code).toBe(0);
    expect(fs.existsSync(path.join(dir, '.git', 'TIDE_CONFLICTS'))).toBe(false);
    const status = JSON.parse((await git(dir, ['__tide', 'status'])).out);
    expect(status.changes).toEqual([{ path: 'a.txt', code: 'D ' }]);
    expect((await git(dir, ['commit', '-m', 'merge'])).code).toBe(0);
    expect(real(dir, 'ls-tree', '--name-only', 'HEAD')).toBe('b.txt\n');
    expect(real(dir, 'log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2);
  });
});

withGit('rebase and Git Pro merge across a folder that became a file', () => {
  /** up replaces folder d/ with a file d; main has a commit of its own. */
  async function typeChange() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'd/x', 'x\n');
    write(dir, 'a.txt', 'a\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'up']);
    await git(dir, ['checkout', 'up']);
    await git(dir, ['rm', '-rq', 'd']);
    write(dir, 'd', 'file\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'up']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'a.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    return dir;
  }

  it('rebase keeps the file in the rewritten commit', async () => {
    const dir = await typeChange();
    const r = await git(dir, ['rebase', 'up']);
    expect(r.code).toBe(0);
    expect(real(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('a.txt\nd\n');
    expect(real(dir, 'show', 'HEAD:d')).toBe('file\n');
    expect(real(dir, 'show', 'HEAD:a.txt')).toBe('main\n');
    expect(read(dir, 'd')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('rebase fast-forwards across it, and abort goes back across it', async () => {
    const dir = await typeChange();
    // Fast-forward: a branch with nothing of its own.
    await git(dir, ['checkout', '-b', 'behind', 'up~1']);
    real(dir, 'reset', '-q', '--hard', real(dir, 'rev-parse', 'up~1').trim());
    expect((await git(dir, ['rebase', 'up'])).code).toBe(0);
    expect(read(dir, 'd')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');

    // Abort: main's own commit conflicts with one on up2, which also has the file.
    await git(dir, ['checkout', 'up']);
    await git(dir, ['checkout', '-b', 'up2']);
    write(dir, 'a.txt', 'up2\n');
    await git(dir, ['commit', '-am', 'up2']);
    await git(dir, ['checkout', 'main']);
    const before = real(dir, 'rev-parse', 'HEAD');
    const r = await git(dir, ['rebase', 'up2']);
    expect(r.out).toMatch(/conflict/i);
    expect(read(dir, 'd')).toBe('file\n');
    expect((await git(dir, ['rebase', '--abort'])).code).toBe(0);
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(read(dir, 'd/x')).toBe('x\n');
    expect(read(dir, 'a.txt')).toBe('main\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('Git Pro merge leaves the file, staged and committed', async () => {
    const dir = await typeChange();
    const r = JSON.parse((await git(dir, ['__tide', 'merge', 'up'])).out);
    expect(r.conflicts).toEqual([]);
    expect(real(dir, 'log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2);
    expect(real(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('a.txt\nd\n');
    expect(fs.lstatSync(path.join(dir, 'd')).isFile()).toBe(true);
    expect(read(dir, 'd')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('Git Pro merge with a conflict elsewhere takes their file in place of the folder', async () => {
    const dir = await typeChange();
    await git(dir, ['checkout', 'up']);
    write(dir, 'a.txt', 'up\n');
    await git(dir, ['commit', '-am', 'up a']);
    await git(dir, ['checkout', 'main']);
    expect(JSON.parse((await git(dir, ['__tide', 'merge', 'up'])).out).conflicts).toEqual(['a.txt']);
    expect(read(dir, 'd')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('UU a.txt\nA  d\nD  d/x\n');
  });
});

withGit('a conflicted Git Pro merge never writes through a symlink', () => {
  /** zlink -> a.txt and out -> ../outside.txt are committed; feat and main both change c.txt. */
  async function linked() {
    const parent = tmp();
    const dir = path.join(parent, 'repo');
    fs.mkdirSync(dir);
    write(parent, 'outside.txt', 'OUTSIDE\n');
    await git(dir, ['init']);
    write(dir, 'a.txt', 'a\n');
    write(dir, 'c.txt', 'c\n');
    fs.symlinkSync('a.txt', path.join(dir, 'zlink'));
    fs.symlinkSync('../outside.txt', path.join(dir, 'out'));
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['branch', 'feat']);
    await git(dir, ['checkout', 'feat']);
    write(dir, 'c.txt', 'feat\n');
    // Their side points a link somewhere else and adds one leading out of the repo.
    fs.unlinkSync(path.join(dir, 'zlink'));
    fs.symlinkSync('c.txt', path.join(dir, 'zlink'));
    fs.symlinkSync('../outside.txt', path.join(dir, 'out2'));
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'feat']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'c.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    return { dir, parent };
  }

  it('leaves the files links point at, inside and outside the repo, and writes links as links', async () => {
    const { dir, parent } = await linked();
    expect(JSON.parse((await git(dir, ['__tide', 'merge', 'feat'])).out).conflicts).toEqual(['c.txt']);
    expect(read(dir, 'a.txt')).toBe('a\n');
    expect(read(parent, 'outside.txt')).toBe('OUTSIDE\n');
    expect(fs.readlinkSync(path.join(dir, 'zlink'))).toBe('c.txt');
    expect(fs.readlinkSync(path.join(dir, 'out'))).toBe('../outside.txt');
    expect(fs.readlinkSync(path.join(dir, 'out2'))).toBe('../outside.txt');
    expect(read(dir, 'c.txt')).toMatch(/<<<<<<< .*\nmain\n=======\nfeat\n>>>>>>> /);
    expect(real(dir, 'status', '--porcelain')).toBe('UU c.txt\nA  out2\nM  zlink\n');

    write(dir, 'c.txt', 'resolved\n');
    await git(dir, ['add', 'c.txt']);
    expect((await git(dir, ['commit', '-m', 'merge'])).code).toBe(0);
    expect(real(dir, 'ls-tree', 'HEAD', 'zlink', 'out2')).toMatch(/^120000 blob \w+\tout2\n120000 blob \w+\tzlink\n$/);
    expect(real(dir, 'status', '--porcelain')).toBe('');
    expect(read(parent, 'outside.txt')).toBe('OUTSIDE\n');
  });

  it('Git Pro discard puts a link back as a link, never writing through one', async () => {
    const { dir, parent } = await linked();
    // A link to a.txt retargeted out of the repo: discard must not write "a.txt" into outside.txt.
    fs.unlinkSync(path.join(dir, 'zlink'));
    fs.symlinkSync('../outside.txt', path.join(dir, 'zlink'));
    // A link replaced by a plain file.
    fs.unlinkSync(path.join(dir, 'out'));
    write(dir, 'out', 'plain\n');
    expect((await git(dir, ['__tide', 'discard', 'zlink', 'out'])).code).toBe(0);
    expect(fs.readlinkSync(path.join(dir, 'zlink'))).toBe('a.txt');
    expect(fs.readlinkSync(path.join(dir, 'out'))).toBe('../outside.txt');
    expect(read(parent, 'outside.txt')).toBe('OUTSIDE\n');
    expect(read(dir, 'a.txt')).toBe('a\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });
});

withGit('submodules (gitlinks)', () => {
  /** main has a.txt; sub adds submodule lib (a gitlink, made with real git). */
  async function withSubmodule() {
    const dir = tmp();
    real(dir, 'init', '-q');
    write(dir, 'a.txt', 'a\n');
    real(dir, 'add', '-A');
    real(dir, 'commit', '-qm', 'base');
    const sha = real(dir, 'rev-parse', 'HEAD').trim();
    real(dir, 'checkout', '-qb', 'sub');
    real(dir, 'update-index', '--add', '--cacheinfo', `160000,${sha},lib`);
    real(dir, 'commit', '-qm', 'sub');
    fs.mkdirSync(path.join(dir, 'lib'));
    return { dir, sha };
  }

  it('switching away removes the submodule from the index, and back adds it', async () => {
    const { dir, sha } = await withSubmodule();
    expect((await git(dir, ['checkout', 'main'])).code).toBe(0);
    expect(real(dir, 'ls-files', '-s')).not.toMatch(/lib/);
    expect(fs.existsSync(path.join(dir, 'lib'))).toBe(false);
    expect(real(dir, 'status', '--porcelain')).toBe('');
    write(dir, 'a.txt', 'main edit\n');
    expect((await git(dir, ['commit', '-am', 'edit'])).code).toBe(0);
    expect(real(dir, 'ls-tree', '--name-only', 'HEAD')).toBe('a.txt\n');

    expect((await git(dir, ['checkout', 'sub'])).code).toBe(0);
    expect(real(dir, 'ls-files', '-s', 'lib')).toBe(`160000 ${sha} 0\tlib\n`);
    expect(fs.statSync(path.join(dir, 'lib')).isDirectory()).toBe(true);
    expect((await git(dir, ['status', '-s'])).out).toBe('');
    expect(real(dir, 'status', '--porcelain')).toBe('');
    write(dir, 'a.txt', 'sub edit\n');
    expect((await git(dir, ['commit', '-am', 'edit'])).code).toBe(0);
    expect(real(dir, 'ls-tree', 'HEAD', 'lib')).toBe(`160000 commit ${sha}\tlib\n`);
  });

  it("leaves a submodule's files in its folder when switching away, and switches back over them", async () => {
    const { dir, sha } = await withSubmodule();
    write(dir, 'lib/s.txt', 'submodule file\n');
    expect((await git(dir, ['checkout', 'main'])).code).toBe(0);
    expect(read(dir, 'lib/s.txt')).toBe('submodule file\n');
    expect(real(dir, 'ls-files', '-s')).not.toMatch(/lib/);
    expect((await git(dir, ['checkout', 'sub'])).code).toBe(0);
    expect(real(dir, 'ls-files', '-s', 'lib')).toBe(`160000 ${sha} 0\tlib\n`);
    expect(read(dir, 'lib/s.txt')).toBe('submodule file\n');
  });

  describe('pull', () => {
    let server: { url: string; close(): void };
    let root: string;
    beforeAll(async () => {
      root = tmp();
      server = await gitServer(root);
    });
    afterAll(() => server.close());

    it('adds, bumps and removes a submodule, and the next commit keeps what was pulled', async () => {
      const seed = tmp();
      real(seed, 'init', '-q');
      write(seed, 'f.txt', 'one\n');
      real(seed, 'add', '-A');
      real(seed, 'commit', '-qm', 'one');
      const first = real(seed, 'rev-parse', 'HEAD').trim();
      real(root, 'clone', '-q', '--bare', seed, 'subs.git');
      const local = tmp();
      real(local, 'clone', '-q', path.join(root, 'subs.git'), '.');
      real(local, 'remote', 'set-url', 'origin', `${server.url}/subs.git`);
      const pushFrom = tmp();
      real(pushFrom, 'clone', '-q', path.join(root, 'subs.git'), '.');
      const push = (gitlink: string | null, msg: string) => {
        if (gitlink) real(pushFrom, 'update-index', '--add', '--cacheinfo', `160000,${gitlink},lib`);
        else real(pushFrom, 'update-index', '--force-remove', 'lib');
        real(pushFrom, 'commit', '-qm', msg);
        real(pushFrom, 'push', '-q', 'origin', 'main');
      };
      const commitEdit = async (text: string) => {
        write(local, 'f.txt', text);
        expect((await git(local, ['commit', '-am', text.trim()])).code).toBe(0);
        real(pushFrom, 'pull', '-q', '--no-rebase', 'origin', 'main');
      };

      push(first, 'add lib');
      expect((await git(local, ['pull'])).code).toBe(0);
      expect(real(local, 'ls-files', '-s', 'lib')).toBe(`160000 ${first} 0\tlib\n`);
      expect(real(local, 'status', '--porcelain')).toBe('');

      const second = real(pushFrom, 'rev-parse', 'HEAD').trim();
      push(second, 'bump lib');
      expect((await git(local, ['pull'])).code).toBe(0);
      expect(real(local, 'ls-files', '-s', 'lib')).toBe(`160000 ${second} 0\tlib\n`);
      expect(real(local, 'status', '--porcelain')).toBe('');
      // The bump isn't reverted by the next commit.
      await commitEdit('two\n');
      expect(real(local, 'rev-parse', 'HEAD:lib')).toBe(`${second}\n`);

      push(null, 'drop lib');
      expect((await git(local, ['pull'])).code).toBe(0);
      expect(real(local, 'ls-files', '-s')).not.toMatch(/lib/);
      expect(real(local, 'status', '--porcelain')).toBe('');
      await commitEdit('three\n');
      expect(real(local, 'ls-tree', '--name-only', 'HEAD')).toBe('f.txt\n');
    });

    it('a pull into an unborn branch that fails leaves the branch unborn', async () => {
      const seed = tmp();
      real(seed, 'init', '-q');
      write(seed, 'g.txt', 'g\n');
      write(seed, 'h.txt', 'h\n');
      real(seed, 'add', '-A');
      real(seed, 'commit', '-qm', 'one');
      real(root, 'clone', '-q', '--bare', seed, 'unborn.git');
      const unborn = () => {
        const empty = tmp();
        real(empty, 'init', '-q', '-b', 'main');
        real(empty, 'remote', 'add', 'origin', `${server.url}/unborn.git`);
        return empty;
      };
      const isUnborn = (dir: string) => spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/main'], { cwd: dir }).status !== 0;

      // An ignored file where the remote has one: real git refuses this pull too.
      const ignored = unborn();
      write(ignored, '.git/info/exclude', 'g.txt\n');
      write(ignored, 'g.txt', 'mine\n');
      const r = await git(ignored, ['pull', 'origin', 'main']);
      expect(r.code).toBe(128);
      expect(r.out).toMatch(/untracked working tree files would be overwritten by merge:\n\tg\.txt/);
      expect(isUnborn(ignored)).toBe(true);
      expect(read(ignored, 'g.txt')).toBe('mine\n');
      expect(fs.existsSync(path.join(ignored, 'h.txt'))).toBe(false);

      // A nested repo where the remote has a file.
      const nested = unborn();
      real(nested, 'init', '-q', 'g.txt');
      write(nested, 'g.txt/inner.txt', 'mine\n');
      const n = await git(nested, ['pull', 'origin', 'main']);
      expect(n.code).toBe(128);
      expect(isUnborn(nested)).toBe(true);
      expect(read(nested, 'g.txt/inner.txt')).toBe('mine\n');
    });
  });
});

withGit('checkout of a revision, and checks before changes', () => {
  it('checks out HEAD~1 and a short oid across a type change, detached, as real git does', async () => {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'x', 'file\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'file']);
    const first = real(dir, 'rev-parse', 'HEAD').trim();
    await git(dir, ['rm', '-q', 'x']);
    write(dir, 'x/y', 'inside\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'folder']);
    const second = real(dir, 'rev-parse', 'HEAD').trim();

    const r = await git(dir, ['checkout', 'HEAD~1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/HEAD is now at/);
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(`${first}\n`);
    expect(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: dir }).status).not.toBe(0);
    expect(read(dir, 'x')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');

    expect((await git(dir, ['checkout', second.slice(0, 7)])).code).toBe(0);
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(`${second}\n`);
    expect(read(dir, 'x/y')).toBe('inside\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');

    expect((await git(dir, ['checkout', 'main'])).code).toBe(0);
    expect(real(dir, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main\n');
  });

  /** main has d/x and ignores *.log; other has a file d instead. */
  async function folderToFile() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, '.gitignore', '*.log\n');
    write(dir, 'd/x', 'x\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['checkout', '-b', 'other']);
    await git(dir, ['rm', '-rq', 'd']);
    write(dir, 'd', 'file\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'file']);
    await git(dir, ['checkout', 'main']);
    return dir;
  }

  it('a folder holding ignored files becomes a file, as in real git', async () => {
    const dir = await folderToFile();
    write(dir, 'd/build.log', 'log\n');
    write(dir, 'd/deep/more.log', 'log\n');
    const r = await git(dir, ['checkout', 'other']);
    expect(r.code).toBe(0);
    expect(read(dir, 'd')).toBe('file\n');
    expect(real(dir, 'status', '--porcelain', '--ignored')).toBe('');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other\n');
  });

  it('refuses before changing anything when a file that is not ignored is in that folder', async () => {
    const dir = await folderToFile();
    write(dir, 'd/build.log', 'log\n');
    write(dir, 'd/notes', 'mine\n');
    const r = await git(dir, ['checkout', 'other']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/untracked working tree files would be overwritten by checkout:\n\td\/notes/);
    expect(read(dir, 'd/x')).toBe('x\n');
    expect(read(dir, 'd/build.log')).toBe('log\n');
    expect(real(dir, 'status', '--porcelain')).toBe('?? d/notes\n');
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\n');
  });

  it('refuses before changing anything when a nested repo is in that folder', async () => {
    const dir = await folderToFile();
    real(dir, 'init', '-q', 'd/nested');
    const r = await git(dir, ['checkout', 'other']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/would be (removed|overwritten) by checkout/);
    expect(read(dir, 'd/x')).toBe('x\n');
    expect(fs.existsSync(path.join(dir, 'd/nested/.git/HEAD'))).toBe(true);
    expect(real(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main\n');
    expect(real(dir, 'ls-files', '-s', 'd/x')).toMatch(/\td\/x\n$/);
  });
});

describe('credentials', () => {
  class GitError extends Error {}
  const auth = (env: Record<string, string>) => createAuth({ env, GitError });

  it('sends the GitHub token to github.com only', () => {
    const { onAuth } = auth({ TIDE_GIT_TOKEN: 'ghp_secret' });
    expect(onAuth('https://github.com/me/repo.git')).toEqual({ username: 'x-access-token', password: 'ghp_secret' });
    expect(onAuth('https://GitHub.com/me/repo.git')).toEqual({ username: 'x-access-token', password: 'ghp_secret' });
    for (const url of [
      'https://evil.com/me/repo.git',
      'https://github.com.evil.com/me/repo.git',
      'https://evil.com/github.com/repo.git',
      'https://github.com@evil.com/repo.git',
      'https://evilgithub.com/repo.git',
      'https://github.com:8443/repo.git',
      'https://gitlab.com/me/repo.git',
    ]) {
      expect(() => onAuth(url)).toThrow(/add an account for .* in Settings/);
    }
  });

  it('uses the account saved for exactly that host', () => {
    const { onAuth } = auth({ TIDE_GIT_TOKEN: 'ghp_secret', TIDE_GIT_HOSTS: JSON.stringify({ 'gitlab.com': { username: 'oauth2', password: 'glpat' } }) });
    expect(onAuth('https://gitlab.com/me/repo.git')).toEqual({ username: 'oauth2', password: 'glpat' });
    expect(() => onAuth('https://gitlab.com.evil.com/me/repo.git')).toThrow(GitError);
    expect(hostOf('https://user@GitLab.com:8443/x')).toBe('gitlab.com:8443');
  });

  it('never sends a credential over plain http', () => {
    const { onAuth } = auth({ TIDE_GIT_TOKEN: 'ghp_secret', TIDE_GIT_HOSTS: JSON.stringify({ 'gitlab.com': { username: 'oauth2', password: 'glpat' } }) });
    expect(() => onAuth('http://github.com/me/repo.git')).toThrow(/isn't encrypted/);
    expect(() => onAuth('http://gitlab.com/me/repo.git')).toThrow(/isn't encrypted/);
  });

  it('does not leak the token to a server that answers 401', async () => {
    const seen: (string | undefined)[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const dir = tmp();
      const r = await git(dir, ['clone', `http://127.0.0.1:${port}/me/repo.git`, 'repo'], { TIDE_GIT_TOKEN: 'ghp_secret' });
      expect(r.code).toBe(128);
      expect(r.out).toMatch(/isn't encrypted/);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((h) => h === undefined)).toBe(true);
    } finally {
      server.close();
    }
  });
});

withGit('Git Pro abort-merge', () => {
  it('never writes through a link, and keeps +x and links in the index', async () => {
    const parent = tmp();
    const dir = path.join(parent, 'repo');
    fs.mkdirSync(dir);
    write(parent, 'outside.txt', 'OUTSIDE\n');
    await git(dir, ['init']);
    write(dir, 'c.txt', 'c\n');
    write(dir, 'run.sh', 'echo hi\n');
    fs.chmodSync(path.join(dir, 'run.sh'), 0o755);
    fs.symlinkSync('../outside.txt', path.join(dir, 'out'));
    fs.symlinkSync('c.txt', path.join(dir, 'zlink'));
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['checkout', '-b', 'feat']);
    write(dir, 'c.txt', 'feat\n');
    await git(dir, ['commit', '-am', 'feat']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'c.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    expect(JSON.parse((await git(dir, ['__tide', 'merge', 'feat'])).out).conflicts).toEqual(['c.txt']);

    expect((await git(dir, ['__tide', 'abort-merge'])).code).toBe(0);
    expect(read(parent, 'outside.txt')).toBe('OUTSIDE\n');
    expect(fs.readlinkSync(path.join(dir, 'out'))).toBe('../outside.txt');
    expect(fs.readlinkSync(path.join(dir, 'zlink'))).toBe('c.txt');
    expect(fs.statSync(path.join(dir, 'run.sh')).mode & 0o111).not.toBe(0);
    expect(read(dir, 'c.txt')).toBe('main\n');
    expect(real(dir, 'ls-files', '-s', 'out', 'run.sh', 'zlink')).toMatch(/^120000 \w+ 0\tout\n100755 \w+ 0\trun\.sh\n120000 \w+ 0\tzlink\n$/);
    expect(real(dir, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    // The next commit keeps the modes.
    write(dir, 'c.txt', 'next\n');
    expect((await git(dir, ['commit', '-am', 'next'])).code).toBe(0);
    expect(real(dir, 'ls-tree', 'HEAD', 'out', 'run.sh', 'zlink')).toMatch(/^120000 blob \w+\tout\n100755 blob \w+\trun\.sh\n120000 blob \w+\tzlink\n$/);
  });
});

withGit('submodule changes are shown and staged', () => {
  /** A repo `sub` with commits A, B, C, and a parent repo whose `lib` is a gitlink at A. */
  async function parentWithSubmodule() {
    const subrepo = tmp();
    real(subrepo, 'init', '-q');
    const shas: string[] = [];
    for (const n of ['A', 'B', 'C']) {
      write(subrepo, 's.txt', `${n}\n`);
      real(subrepo, 'add', '-A');
      real(subrepo, 'commit', '-qm', n);
      shas.push(real(subrepo, 'rev-parse', 'HEAD').trim());
    }
    const dir = tmp();
    real(dir, 'init', '-q');
    write(dir, 'a.txt', 'a\n');
    real(dir, 'add', '-A');
    real(dir, 'update-index', '--add', '--cacheinfo', `160000,${shas[0]},lib`);
    real(dir, 'commit', '-qm', 'base');
    fs.mkdirSync(path.join(dir, 'lib'));
    return { dir, subrepo, shas };
  }
  /** Sets the submodule's folder up as a clone at `sha`. */
  function populate(dir: string, subrepo: string, sha: string) {
    fs.rmSync(path.join(dir, 'lib'), { recursive: true, force: true });
    real(dir, 'clone', '-q', subrepo, 'lib');
    real(path.join(dir, 'lib'), 'checkout', '-q', sha);
  }

  it.each(['add lib', 'add -A', 'commit -a'])('a submodule moved to a new commit shows as  M and goes in with %s', async (how) => {
    const { dir, subrepo, shas } = await parentWithSubmodule();
    populate(dir, subrepo, shas[0]);
    expect((await git(dir, ['status', '-s'])).out).toBe('');
    real(path.join(dir, 'lib'), 'checkout', '-q', shas[1]);
    expect(real(dir, 'status', '--porcelain')).toBe(' M lib\n');
    expect((await git(dir, ['status', '-s'])).out).toBe(' M lib\n');
    expect(JSON.parse((await git(dir, ['__tide', 'status'])).out).changes).toEqual([{ path: 'lib', code: ' M' }]);
    if (how === 'commit -a') expect((await git(dir, ['commit', '-am', 'bump'])).code).toBe(0);
    else {
      expect((await git(dir, how.split(' '))).code).toBe(0);
      expect(real(dir, 'status', '--porcelain')).toBe('M  lib\n');
      expect((await git(dir, ['status', '-s'])).out).toBe('M  lib\n');
      expect((await git(dir, ['commit', '-m', 'bump'])).code).toBe(0);
    }
    expect(real(dir, 'rev-parse', 'HEAD:lib')).toBe(`${shas[1]}\n`);
    // Never the submodule's own files.
    expect(real(dir, 'ls-files')).toBe('a.txt\nlib\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it("Git Pro's Stage stages a populated submodule as one entry, and Unstage puts HEAD's back", async () => {
    const { dir, subrepo, shas } = await parentWithSubmodule();
    populate(dir, subrepo, shas[2]);
    write(dir, 'lib/new.txt', 'untracked in the submodule\n');
    expect((await git(dir, ['__tide', 'stage', 'lib'])).code).toBe(0);
    expect(real(dir, 'ls-files', '-s')).toMatch(new RegExp(`^100644 \\w+ 0\\ta\\.txt\\n160000 ${shas[2]} 0\\tlib\\n$`));
    expect(real(dir, 'diff', '--cached', '--name-only')).toBe('lib\n');
    expect((await git(dir, ['__tide', 'unstage', 'lib'])).code).toBe(0);
    expect(real(dir, 'ls-files', '-s', 'lib')).toBe(`160000 ${shas[0]} 0\tlib\n`);
  });

  it('git diff --stat shows a moved submodule as real git does', async () => {
    const { dir, subrepo, shas } = await parentWithSubmodule();
    populate(dir, subrepo, shas[1]);
    const r = await git(dir, ['diff', '--stat']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ lib \| 2 /);
    expect(real(dir, 'diff', '--stat')).toMatch(/ lib \| 2 /);
  });

  /** main moved lib to C; `other` moved it to B: a cherry-pick of other conflicts in lib. */
  async function bothMoved() {
    const env = await parentWithSubmodule();
    const { dir, shas } = env;
    real(dir, 'checkout', '-qb', 'other');
    real(dir, 'update-index', '--cacheinfo', `160000,${shas[1]},lib`);
    real(dir, 'commit', '-qm', 'to B');
    real(dir, 'checkout', '-q', 'main');
    real(dir, 'update-index', '--cacheinfo', `160000,${shas[2]},lib`);
    real(dir, 'commit', '-qm', 'to C');
    return env;
  }

  it('a submodule conflict from cherry-pick shows as UU, and git add keeps ours when the folder is not set up', async () => {
    const { dir, shas } = await bothMoved();
    const r = await git(dir, ['cherry-pick', 'other']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CONFLICT: merge conflict in lib/);
    expect((await git(dir, ['status', '-s'])).out).toBe('UU lib\n');
    expect(JSON.parse((await git(dir, ['__tide', 'status'])).out).changes).toEqual([{ path: 'lib', code: 'UU' }]);
    expect((await git(dir, ['commit', '-m', 'x'])).out).toMatch(/unmerged files: lib/);
    expect((await git(dir, ['add', 'lib'])).code).toBe(0);
    expect(fs.existsSync(path.join(dir, '.git', 'TIDE_CONFLICTS'))).toBe(false);
    expect(real(dir, 'ls-files', '-s', 'lib')).toBe(`160000 ${shas[2]} 0\tlib\n`);
    const c = await git(dir, ['cherry-pick', '--continue']);
    expect(c.code).toBe(0);
    expect(c.out).toMatch(/Nothing was staged/);
    expect(fs.existsSync(path.join(dir, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('a submodule conflict from rebase is resolved by staging the commit the folder has checked out', async () => {
    const { dir, subrepo, shas } = await bothMoved();
    const r = await git(dir, ['rebase', 'other']);
    // main's "to C" replayed onto other's "to B".
    expect(r.code).toBe(1);
    expect((await git(dir, ['status', '-s'])).out).toBe('UU lib\n');
    populate(dir, subrepo, shas[2]);
    expect((await git(dir, ['__tide', 'stage', 'lib'])).code).toBe(0);
    expect(real(dir, 'ls-files', '-s')).toBe(`${real(dir, 'ls-files', '-s', 'a.txt')}160000 ${shas[2]} 0\tlib\n`);
    expect((await git(dir, ['rebase', '--continue'])).code).toBe(0);
    expect(real(dir, 'rev-parse', 'HEAD:lib')).toBe(`${shas[2]}\n`);
    expect(real(dir, 'rev-parse', 'HEAD~1')).toBe(real(dir, 'rev-parse', 'other'));
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('a Git Pro merge where both sides moved a submodule stops with it conflicted instead of failing', async () => {
    const { dir, shas } = await bothMoved();
    // A change elsewhere on their side merges cleanly alongside.
    real(dir, 'checkout', '-q', 'other');
    write(dir, 'b.txt', 'b\n');
    real(dir, 'add', 'b.txt');
    real(dir, 'commit', '-qm', 'b');
    real(dir, 'checkout', '-q', 'main');
    const r = await git(dir, ['__tide', 'merge', 'other']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).conflicts).toEqual(['lib']);
    expect(real(dir, 'status', '--porcelain')).toBe('A  b.txt\n');
    expect(JSON.parse((await git(dir, ['__tide', 'status'])).out).changes).toEqual([
      { path: 'b.txt', code: 'A ' },
      { path: 'lib', code: 'UU' },
    ]);
    expect((await git(dir, ['__tide', 'stage', 'lib'])).code).toBe(0);
    expect((await git(dir, ['__tide', 'commit', Buffer.from('merge').toString('base64')])).code).toBe(0);
    expect(real(dir, 'log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2);
    expect(real(dir, 'rev-parse', 'HEAD:lib')).toBe(`${shas[2]}\n`);
    expect(real(dir, 'show', 'HEAD:b.txt')).toBe('b\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('stash saves and undoes a staged submodule move with other changes, and show prints it', async () => {
    const { dir, shas } = await parentWithSubmodule();
    real(dir, 'update-index', '--cacheinfo', `160000,${shas[1]},lib`);
    // Alone, real git has nothing to save; neither has this git.
    expect((await git(dir, ['stash'])).out).toMatch(/No local changes to save/);
    expect(real(dir, 'status', '--porcelain')).toBe('M  lib\n');
    write(dir, 'a.txt', 'edit\n');
    expect((await git(dir, ['stash'])).code).toBe(0);
    expect(real(dir, 'status', '--porcelain')).toBe('');
    expect(real(dir, 'ls-files', '-s', 'lib')).toBe(`160000 ${shas[0]} 0\tlib\n`);
    expect(real(dir, 'rev-parse', 'stash^2:lib')).toBe(`${shas[1]}\n`);
    const show = await git(dir, ['stash', 'show']);
    expect(show.code).toBe(0);
    expect(show.out).toMatch(/ a\.txt \| 2 /);
    expect(show.out).toMatch(/ lib \| 2 /);
    expect(show.out).toMatch(/2 files changed/);
    expect(real(dir, 'stash', 'show', '--stat')).toMatch(/ lib +\| 2 /);
    expect((await git(dir, ['stash', 'pop'])).code).toBe(0);
    expect(read(dir, 'a.txt')).toBe('edit\n');
    // As real git leaves it: changes unstaged, the submodule back as HEAD has it in the index.
    expect(real(dir, 'ls-files', '-s', 'lib')).toBe(`160000 ${shas[0]} 0\tlib\n`);
    expect(real(dir, 'status', '--porcelain')).toBe(' M a.txt\n');
  });
});

withGit('cherry-pick, rebase and stash across a folder that became a file', () => {
  /** main has x/a and x/b; `tofile` replaces them with a file x; `tofolder` (from tofile) goes back. */
  async function typeChange() {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'x/a', 'a\n');
    write(dir, 'x/b', 'b\n');
    write(dir, 'm', 'm\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['checkout', '-b', 'tofile']);
    await git(dir, ['rm', '-rq', 'x']);
    write(dir, 'x', 'file\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'tofile']);
    await git(dir, ['checkout', 'main']);
    write(dir, 'm', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    return dir;
  }

  it('cherry-pick takes a folder to a file and back', async () => {
    const dir = await typeChange();
    const r = await git(dir, ['cherry-pick', 'tofile']);
    expect(r.out).not.toMatch(/EISDIR/);
    expect(r.code).toBe(0);
    expect(read(dir, 'x')).toBe('file\n');
    expect(real(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('m\nx\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
    real(dir, 'revert', '--no-edit', 'HEAD');
    expect(read(dir, 'x/a')).toBe('a\n');
    await git(dir, ['checkout', '-b', 'again']);
    const back = real(dir, 'rev-parse', 'HEAD').trim();
    real(dir, 'reset', '-q', '--hard', 'HEAD~1');
    expect((await git(dir, ['cherry-pick', back])).code).toBe(0);
    expect(read(dir, 'x/a')).toBe('a\n');
    expect(read(dir, 'x/b')).toBe('b\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('rebase replays it', async () => {
    const dir = await typeChange();
    await git(dir, ['checkout', 'tofile']);
    // tofile's own commit replayed onto main.
    const r = await git(dir, ['rebase', 'main']);
    expect(r.code).toBe(0);
    expect(read(dir, 'x')).toBe('file\n');
    expect(real(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).toBe('m\nx\n');
    expect(real(dir, 'show', 'HEAD:m')).toBe('main\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });

  it('stash apply puts a stashed folder-to-file change back', async () => {
    const dir = await typeChange();
    await git(dir, ['rm', '-rq', 'x']);
    write(dir, 'x', 'stashed file\n');
    await git(dir, ['add', 'x']);
    expect((await git(dir, ['stash'])).code).toBe(0);
    expect(read(dir, 'x/a')).toBe('a\n');
    const r = await git(dir, ['stash', 'apply']);
    expect(r.out).not.toMatch(/EISDIR/);
    expect(r.code).toBe(0);
    expect(read(dir, 'x')).toBe('stashed file\n');
    expect(real(dir, 'status', '--porcelain')).toBe('A  x\nD  x/a\nD  x/b\n');
  });

  it('refuses before changing anything when an untracked file is in the folder', async () => {
    const dir = await typeChange();
    write(dir, 'x/notes', 'mine\n');
    const before = real(dir, 'rev-parse', 'HEAD');
    const r = await git(dir, ['cherry-pick', 'tofile']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/untracked working tree files would be overwritten by merge:\n\tx\/notes/);
    expect(read(dir, 'x/a')).toBe('a\n');
    expect(read(dir, 'x/notes')).toBe('mine\n');
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(real(dir, 'status', '--porcelain')).toBe('?? x/notes\n');
    expect(fs.existsSync(path.join(dir, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });
});

withGit('a conflict with a symlink on one side', () => {
  it('keeps ours and never makes a link to the conflict markers', async () => {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'f', 'one\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['checkout', '-b', 'side']);
    write(dir, 'f', 'one\nTWO\n');
    await git(dir, ['commit', '-am', 'edit']);
    await git(dir, ['checkout', 'main']);
    fs.unlinkSync(path.join(dir, 'f'));
    fs.symlinkSync('target', path.join(dir, 'f'));
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'link']);
    const r = await git(dir, ['cherry-pick', 'side']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CONFLICT: merge conflict in f/);
    expect(fs.readlinkSync(path.join(dir, 'f'))).toBe('target');
    expect(JSON.parse((await git(dir, ['__tide', 'status'])).out).changes).toEqual([{ path: 'f', code: 'UU' }]);
    expect((await git(dir, ['status', '-s'])).out).toBe('UU f\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
    // Staging it as it is (ours) resolves it.
    expect((await git(dir, ['add', 'f'])).code).toBe(0);
    expect((await git(dir, ['status', '-s'])).out).toBe('');
    expect((await git(dir, ['cherry-pick', '--continue'])).code).toBe(0);
    expect(fs.readlinkSync(path.join(dir, 'f'))).toBe('target');
    // The other way round: their link onto our edited file.
    expect((await git(dir, ['cherry-pick', 'side'])).code).toBe(1);
    await git(dir, ['cherry-pick', '--abort']);
    await git(dir, ['checkout', 'side']);
    const p = await git(dir, ['cherry-pick', 'main']);
    expect(p.code).toBe(1);
    expect(fs.lstatSync(path.join(dir, 'f')).isFile()).toBe(true);
    expect(read(dir, 'f')).toBe('one\nTWO\n');
  });
});

withGit('cherry-pick --quit', () => {
  it('forgets the cherry-pick and keeps the working tree and index', async () => {
    const dir = await twoBranches();
    await git(dir, ['checkout', 'other']);
    write(dir, 'f.txt', 'other\n');
    write(dir, 'n.txt', 'n\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'other']);
    await git(dir, ['checkout', 'main']);
    const head = real(dir, 'rev-parse', 'HEAD');
    expect((await git(dir, ['cherry-pick', 'other'])).code).toBe(1);
    const markers = read(dir, 'f.txt');
    expect(markers).toMatch(/<<<<<<< /);
    expect((await git(dir, ['cherry-pick', '--quit'])).code).toBe(0);
    expect(fs.existsSync(path.join(dir, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
    expect(read(dir, 'f.txt')).toBe(markers);
    expect(real(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(real(dir, 'status', '--porcelain')).toBe(' M f.txt\nA  n.txt\n');
    // The conflict stays until the file is staged, as real git keeps it unmerged.
    expect((await git(dir, ['commit', '-m', 'x'])).out).toMatch(/unmerged files: f\.txt/);
    expect((await git(dir, ['cherry-pick', '--continue'])).out).toMatch(/no cherry-pick in progress/);
  });
});

withGit('empty folders', () => {
  it('checkout and rebase --abort remove folders whose tracked files went', async () => {
    const dir = tmp();
    await git(dir, ['init']);
    write(dir, 'a.txt', 'a\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'base']);
    await git(dir, ['checkout', '-b', 'deep']);
    write(dir, 'd/e/f.txt', 'f\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'deep']);
    expect((await git(dir, ['checkout', 'main'])).code).toBe(0);
    expect(fs.existsSync(path.join(dir, 'd'))).toBe(false);

    // A rebase of deep that stops, then is aborted from main's files.
    write(dir, 'a.txt', 'main\n');
    await git(dir, ['commit', '-am', 'main']);
    await git(dir, ['checkout', 'deep']);
    write(dir, 'a.txt', 'deep\n');
    await git(dir, ['commit', '-am', 'deep a']);
    await git(dir, ['checkout', 'main']);
    await git(dir, ['checkout', '-b', 'up']);
    expect((await git(dir, ['rebase', 'deep'])).code).toBe(1);
    expect(read(dir, 'd/e/f.txt')).toBe('f\n');
    expect((await git(dir, ['rebase', '--abort'])).code).toBe(0);
    expect(fs.existsSync(path.join(dir, 'd'))).toBe(false);
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });
});

withGit('a tag and a branch with the same name', () => {
  /** Branch dev at "three", tag dev at "one". */
  async function tagged() {
    const dir = tmp();
    await git(dir, ['init']);
    for (const n of ['one', 'two', 'three']) {
      write(dir, 'a', `${n}\n`);
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-m', n]);
      if (n === 'one') await git(dir, ['tag', 'dev']);
    }
    await git(dir, ['branch', 'dev']);
    await git(dir, ['checkout', '-b', 'x']);
    write(dir, 'b', 'x\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'x']);
    return dir;
  }

  it.each(['cli', 'gitpro'])('checkout goes to the branch, with its files and index (%s)', async (via) => {
    const dir = await tagged();
    const r = via === 'cli' ? await git(dir, ['checkout', 'dev']) : await git(dir, ['__tide', 'checkout', 'dev']);
    expect(r.code).toBe(0);
    expect(real(dir, 'symbolic-ref', 'HEAD')).toBe('refs/heads/dev\n');
    expect(read(dir, 'a')).toBe('three\n');
    expect(fs.existsSync(path.join(dir, 'b'))).toBe(false);
    expect(real(dir, 'status', '--porcelain')).toBe('');
    // The next commit builds on the branch, reverting nothing.
    write(dir, 'c', 'c\n');
    await git(dir, ['add', 'c']);
    await git(dir, ['commit', '-m', 'c']);
    expect(real(dir, 'show', 'HEAD:a')).toBe('three\n');
    expect(real(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('c\n');
  });

  it('Git Pro merge uses the branches, not tags of the same names', async () => {
    const dir = await tagged();
    await git(dir, ['checkout', 'dev']);
    write(dir, 'd', 'd\n');
    await git(dir, ['add', 'd']);
    await git(dir, ['commit', '-m', 'd']);
    await git(dir, ['tag', 'x', 'dev~2']);
    const r = await git(dir, ['__tide', 'merge', 'x']);
    expect(r.code).toBe(0);
    expect(real(dir, 'show', 'HEAD:b')).toBe('x\n');
    expect(real(dir, 'show', 'HEAD:d')).toBe('d\n');
    expect(real(dir, 'show', 'HEAD:a')).toBe('three\n');
    expect(real(dir, 'status', '--porcelain')).toBe('');
  });
});

withGit('pull with a tag named like the branch, and both sides moving a submodule', () => {
  let server: { url: string; close(): void };
  let root: string;
  beforeAll(async () => {
    root = tmp();
    server = await gitServer(root);
  });
  afterAll(() => server.close());

  it('merges into the branch, not the tag', async () => {
    const seed = tmp();
    real(seed, 'init', '-q');
    write(seed, 'f.txt', 'one\n');
    real(seed, 'add', '-A');
    real(seed, 'commit', '-qm', 'one');
    real(root, 'clone', '-q', '--bare', seed, 'tagged.git');
    const local = tmp();
    real(local, 'clone', '-q', path.join(root, 'tagged.git'), '.');
    real(local, 'remote', 'set-url', 'origin', `${server.url}/tagged.git`);
    real(local, 'tag', 'main');
    write(local, 'mine.txt', 'mine\n');
    await git(local, ['add', 'mine.txt']);
    await git(local, ['commit', '-m', 'mine']);
    const mine = real(local, 'rev-parse', 'HEAD').trim();
    write(seed, 'theirs.txt', 'theirs\n');
    real(seed, 'add', '-A');
    real(seed, 'commit', '-qm', 'theirs');
    real(seed, 'push', '-q', path.join(root, 'tagged.git'), 'main');
    const r = await git(local, ['pull']);
    expect(r.code).toBe(0);
    expect(real(local, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main\n');
    expect(real(local, 'log', '-1', '--format=%P').trim().split(' ')[0]).toBe(mine);
    expect(read(local, 'mine.txt')).toBe('mine\n');
    expect(read(local, 'theirs.txt')).toBe('theirs\n');
    expect(real(local, 'status', '--porcelain')).toBe('');
  });

  it('a pull where both sides moved a submodule says so and changes nothing', async () => {
    const shas: string[] = [];
    const subrepo = tmp();
    real(subrepo, 'init', '-q');
    for (const n of ['A', 'B', 'C']) {
      write(subrepo, 's', `${n}\n`);
      real(subrepo, 'add', '-A');
      real(subrepo, 'commit', '-qm', n);
      shas.push(real(subrepo, 'rev-parse', 'HEAD').trim());
    }
    const seed = tmp();
    real(seed, 'init', '-q');
    write(seed, 'f.txt', 'one\n');
    real(seed, 'add', '-A');
    real(seed, 'update-index', '--add', '--cacheinfo', `160000,${shas[0]},lib`);
    real(seed, 'commit', '-qm', 'one');
    real(root, 'clone', '-q', '--bare', seed, 'subboth.git');
    const local = tmp();
    real(local, 'clone', '-q', path.join(root, 'subboth.git'), '.');
    real(local, 'remote', 'set-url', 'origin', `${server.url}/subboth.git`);
    real(local, 'update-index', '--cacheinfo', `160000,${shas[2]},lib`);
    real(local, 'commit', '-qm', 'to C');
    const head = real(local, 'rev-parse', 'HEAD');
    real(seed, 'update-index', '--cacheinfo', `160000,${shas[1]},lib`);
    real(seed, 'commit', '-qm', 'to B');
    real(seed, 'push', '-q', path.join(root, 'subboth.git'), 'main');
    const r = await git(local, ['pull']);
    expect(r.code).toBe(128);
    expect(r.out).toMatch(/nothing was changed\. Merge origin\/main from Git Pro/);
    expect(r.out).not.toMatch(/not supported yet/);
    expect(real(local, 'rev-parse', 'HEAD')).toBe(head);
    expect(real(local, 'status', '--porcelain')).toBe('');
  });
});
