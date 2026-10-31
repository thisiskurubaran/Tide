// @ts-check
// `git` in the local shell, on isomorphic-git. Runs in a worker like npm and
// pip. The app passes the access token and commit identity from the Keychain
// as TIDE_GIT_TOKEN, TIDE_GIT_NAME and TIDE_GIT_EMAIL for this run only.
'use strict';

const fs = require('fs');
const path = require('path');

// isomorphic-git compresses with CompressionStream when it exists and reads the
// result through `new Response()`, which loads Node's undici. undici needs
// WebAssembly, and nodejs-mobile on iOS runs V8 without it, so every commit
// failed. Without these globals it uses its bundled pako instead.
delete globalThis.CompressionStream;
delete globalThis.DecompressionStream;

const { git, http } = require('./isogit');
const { porcelainCode } = require('./status');
const { lineStat } = require('./diffstat');
const { createUi } = require('./ui');

const USAGE = `usage: git <command>

  clone <url> [dir]     init                  status [-s]
  add <path>... | -A    rm <path>...          commit [-a] -m <message>
  log [--oneline] [-n N]                      diff [--stat]
  branch [name]         checkout [-b] <branch>
  remote [-v] | remote add <name> <url>
  push [remote] [branch]                      pull [remote] [branch]

Anything else needs Remote mode, which has the real git.`;

const env = process.env;

class GitError extends Error {}

function author() {
  if (!env.TIDE_GIT_NAME || !env.TIDE_GIT_EMAIL) {
    throw new GitError('set your name and email in Settings, Git before committing');
  }
  return { name: env.TIDE_GIT_NAME, email: env.TIDE_GIT_EMAIL };
}

// Signed-in GitLab and Bitbucket accounts, as JSON {host: {username, password}}.
const hostCredentials = (() => {
  try {
    return JSON.parse(env.TIDE_GIT_HOSTS || '{}');
  } catch {
    return {};
  }
})();

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

const canAuth = () => !!env.TIDE_GIT_TOKEN || Object.keys(hostCredentials).length > 0;

// An account for the remote's host when there is one; otherwise the token from
// Settings, which GitHub, GitLab and Gitea all accept as the password.
/** @param {string} url */
function onAuth(url) {
  const account = hostCredentials[hostOf(url)];
  if (account) return { username: account.username, password: account.password };
  if (!env.TIDE_GIT_TOKEN) throw new GitError('this remote needs a token: add one in Settings, Git');
  return { username: 'x-access-token', password: env.TIDE_GIT_TOKEN };
}

function onAuthFailure() {
  throw new GitError('the remote rejected the token (check it has access to this repository)');
}

let lastProgress = '';
/** @param {{ phase: string, loaded: number, total?: number }} p */
function onProgress(p) {
  const line = p.total ? `${p.phase}: ${Math.round((100 * p.loaded) / p.total)}% (${p.loaded}/${p.total})` : `${p.phase}: ${p.loaded}`;
  if (line === lastProgress) return;
  lastProgress = line;
  process.stdout.write(`\r\x1b[K${line}`);
}
function endProgress() {
  if (lastProgress) process.stdout.write('\n');
  lastProgress = '';
}

async function findRoot() {
  try {
    return await git.findRoot({ fs, filepath: process.cwd() });
  } catch {
    throw new GitError('not a git repository (run git init or git clone first)');
  }
}

/** Path relative to the repo root, from one relative to the current directory. */
function repoPath(dir, p) {
  const rel = path.relative(dir, path.resolve(process.cwd(), p)).split(path.sep).join('/');
  if (rel.startsWith('..')) throw new GitError(`${p} is outside the repository`);
  return rel === '' ? '.' : rel;
}

/** @param {string[]} args */
function takeFlag(args, ...names) {
  const i = args.findIndex((a) => names.includes(a));
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

/** @param {string[]} args */
function takeValue(args, ...names) {
  const i = args.findIndex((a) => names.includes(a));
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  if (value === undefined) throw new GitError(`${args[i] ?? names[0]} needs a value`);
  return value;
}

async function changes(dir, filepaths) {
  const rows = await recheckRacy(dir, await git.statusMatrix({ fs, dir, filepaths }));
  return rows.map((row) => ({ path: row[0], code: porcelainCode(row), row })).filter((c) => c.code !== null);
}

const seconds = (p) => Math.floor(fs.statSync(p).mtimeMs / 1000);

// statusMatrix trusts size and mtime in whole seconds, so a same-size edit made
// in the same second as the last index write looks unchanged (autosave, then
// commit). Real git re-hashes such "racy" files; so does this.
async function recheckRacy(dir, rows) {
  let indexTime;
  try {
    indexTime = seconds(path.join(dir, '.git', 'index'));
  } catch {
    return rows;
  }
  const suspects = rows.filter(([file, head, workdir, stage]) => {
    if (head !== 1 || workdir !== 1 || stage !== 1) return false;
    try {
      return seconds(path.join(dir, file)) >= indexTime;
    } catch {
      return false;
    }
  });
  if (!suspects.length) return rows;
  const wanted = new Set(suspects.map((r) => r[0]));
  const staged = new Map();
  await git.walk({
    fs,
    dir,
    trees: [git.STAGE()],
    map: async (file, [entry]) => {
      if (entry && wanted.has(file)) staged.set(file, await entry.oid());
      return true;
    },
  });
  for (const row of suspects) {
    const { oid } = await git.hashBlob({ object: fs.readFileSync(path.join(dir, row[0])) });
    if (oid !== staged.get(row[0])) row[2] = 2;
  }
  return rows;
}

const commands = {
  async clone(args) {
    const url = args.find((a) => !a.startsWith('-'));
    if (!url) throw new GitError('usage: git clone <url> [dir]');
    const target = args.filter((a) => !a.startsWith('-'))[1] ?? path.basename(url).replace(/\.git$/, '');
    const dir = path.resolve(process.cwd(), target);
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f !== 'tide.json')) {
      throw new GitError(`destination ${target} already exists and is not empty`);
    }
    console.log(`Cloning into '${target}'...`);
    await git.clone({
      fs,
      http,
      dir,
      url,
      singleBranch: true,
      depth: 50,
      onProgress,
      onAuth: canAuth() ? onAuth : undefined,
      onAuthFailure,
    });
    endProgress();
    return 0;
  },

  async init() {
    await git.init({ fs, dir: process.cwd(), defaultBranch: 'main' });
    console.log(`Initialized empty Git repository in ${path.basename(process.cwd())}/.git/`);
    return 0;
  },

  async status(args) {
    const dir = await findRoot();
    const short = takeFlag(args, '-s', '--short', '--porcelain');
    const list = await changes(dir);
    if (short) {
      for (const c of list) console.log(`${c.code} ${c.path}`);
      return 0;
    }
    const branch = await git.currentBranch({ fs, dir });
    console.log(branch ? `On branch ${branch}` : 'HEAD detached');
    const staged = list.filter((c) => c.code[0] !== ' ' && c.code !== '??');
    const unstaged = list.filter((c) => c.code[1] !== ' ' && c.code !== '??');
    const untracked = list.filter((c) => c.code === '??');
    const word = (ch) => ({ M: 'modified', A: 'new file', D: 'deleted' })[ch] ?? 'changed';
    if (staged.length) {
      console.log('\nChanges to be committed:');
      for (const c of staged) console.log(`\t\x1b[32m${word(c.code[0])}:   ${c.path}\x1b[0m`);
    }
    if (unstaged.length) {
      console.log('\nChanges not staged for commit:');
      for (const c of unstaged) console.log(`\t\x1b[31m${word(c.code[1])}:   ${c.path}\x1b[0m`);
    }
    if (untracked.length) {
      console.log('\nUntracked files:');
      for (const c of untracked) console.log(`\t\x1b[31m${c.path}\x1b[0m`);
    }
    if (!list.length) console.log('nothing to commit, working tree clean');
    return 0;
  },

  async add(args) {
    const dir = await findRoot();
    const all = takeFlag(args, '-A', '--all');
    const paths = all ? ['.'] : args.filter((a) => !a.startsWith('-'));
    if (!paths.length) throw new GitError('nothing specified, nothing added');
    const filepaths = paths.map((p) => repoPath(dir, p));
    const list = await changes(dir, filepaths.includes('.') ? undefined : filepaths);
    for (const c of list) {
      if (c.row[2] === 0) await git.remove({ fs, dir, filepath: c.path });
      else await git.add({ fs, dir, filepath: c.path });
    }
    // Staging a file marks its merge conflict resolved (see ui.js).
    const conflicts = path.join(dir, '.git', 'TIDE_CONFLICTS');
    if (fs.existsSync(conflicts)) {
      const staged = new Set(list.map((c) => c.path));
      const left = JSON.parse(fs.readFileSync(conflicts, 'utf8')).filter((p) => !staged.has(p));
      if (left.length) fs.writeFileSync(conflicts, JSON.stringify(left));
      else fs.rmSync(conflicts);
    }
    return 0;
  },

  async rm(args) {
    const dir = await findRoot();
    const cached = takeFlag(args, '--cached');
    for (const p of args.filter((a) => !a.startsWith('-'))) {
      const filepath = repoPath(dir, p);
      await git.remove({ fs, dir, filepath });
      if (!cached) fs.rmSync(path.join(dir, filepath), { force: true, recursive: true });
      console.log(`rm '${filepath}'`);
    }
    return 0;
  },

  async commit(args) {
    const dir = await findRoot();
    // `-am "msg"` is common enough to accept.
    const am = args.indexOf('-am');
    if (am !== -1) args.splice(am, 1, '-a', '-m');
    const all = takeFlag(args, '-a', '--all');
    const message = takeValue(args, '-m', '--message');
    if (!message) throw new GitError('usage: git commit [-a] -m <message>');
    if (all) {
      for (const c of await changes(dir)) {
        if (c.code === '??') continue;
        if (c.row[2] === 0) await git.remove({ fs, dir, filepath: c.path });
        else await git.add({ fs, dir, filepath: c.path });
      }
    }
    const staged = (await changes(dir)).filter((c) => c.code[0] !== ' ' && c.code !== '??');
    if (!staged.length) {
      console.log('nothing to commit (use git add)');
      return 1;
    }
    // A merge started from Git Pro makes this a merge commit, as in real git.
    let parent;
    try {
      const merging = fs.readFileSync(path.join(dir, '.git', 'MERGE_HEAD'), 'utf8').trim();
      parent = [await git.resolveRef({ fs, dir, ref: 'HEAD' }), merging];
    } catch {
      parent = undefined;
    }
    const oid = await git.commit({ fs, dir, message, author: author(), parent });
    if (parent) for (const f of ['MERGE_HEAD', 'MERGE_MSG', 'TIDE_CONFLICTS']) fs.rmSync(path.join(dir, '.git', f), { force: true });
    const branch = (await git.currentBranch({ fs, dir })) ?? 'HEAD';
    console.log(`[${branch} ${oid.slice(0, 7)}] ${message.split('\n')[0]}`);
    console.log(` ${staged.length} file${staged.length === 1 ? '' : 's'} changed`);
    return 0;
  },

  async log(args) {
    const dir = await findRoot();
    const oneline = takeFlag(args, '--oneline');
    const n = Number(takeValue(args, '-n', '--max-count') ?? (args.find((a) => /^-\d+$/.test(a)) ?? '').slice(1)) || 20;
    let entries;
    try {
      entries = await git.log({ fs, dir, depth: n });
    } catch {
      console.log('no commits yet');
      return 0;
    }
    for (const { oid, commit } of entries) {
      const subject = commit.message.split('\n')[0];
      if (oneline) {
        console.log(`\x1b[33m${oid.slice(0, 7)}\x1b[0m ${subject}`);
        continue;
      }
      const date = new Date(commit.author.timestamp * 1000).toUTCString();
      console.log(`\x1b[33mcommit ${oid}\x1b[0m\nAuthor: ${commit.author.name} <${commit.author.email}>\nDate:   ${date}\n`);
      for (const line of commit.message.trimEnd().split('\n')) console.log(`    ${line}`);
      console.log('');
    }
    return 0;
  },

  // Only --stat style output: isomorphic-git has no diff, and a line count is
  // what fits on a phone screen anyway.
  async diff(args) {
    const dir = await findRoot();
    const cached = takeFlag(args, '--cached', '--staged');
    takeFlag(args, '--stat');
    const list = (await changes(dir)).filter((c) => c.code !== '??' && (cached ? c.code[0] !== ' ' : c.code[1] !== ' '));
    let added = 0;
    let removed = 0;
    for (const c of list) {
      /** @param {'head' | 'index' | 'work'} where */
      const read = async (where) => {
        try {
          if (where === 'work') return fs.readFileSync(path.join(dir, c.path), 'utf8');
          const { blob } =
            where === 'head'
              ? await git.readBlob({ fs, dir, oid: await git.resolveRef({ fs, dir, ref: 'HEAD' }), filepath: c.path })
              : await git.readBlob({ fs, dir, oid: await indexOid(dir, c.path) });
          return Buffer.from(blob).toString('utf8');
        } catch {
          // Missing on that side: a new or deleted file.
          return '';
        }
      };
      const before = await read(cached ? 'head' : 'index');
      const after = await read(cached ? 'index' : 'work');
      const stat = lineStat(before, after);
      if (!stat) {
        console.log(` ${c.path} | (too large to count)`);
        continue;
      }
      added += stat.added;
      removed += stat.removed;
      console.log(` ${c.path} | ${stat.added + stat.removed} \x1b[32m${'+'.repeat(Math.min(stat.added, 30))}\x1b[31m${'-'.repeat(Math.min(stat.removed, 30))}\x1b[0m`);
    }
    if (list.length) console.log(` ${list.length} file${list.length === 1 ? '' : 's'} changed, ${added} insertions(+), ${removed} deletions(-)`);
    return 0;
  },

  async branch(args) {
    const dir = await findRoot();
    const name = args.find((a) => !a.startsWith('-'));
    if (name) {
      await git.branch({ fs, dir, ref: name });
      return 0;
    }
    const current = await git.currentBranch({ fs, dir });
    for (const b of await git.listBranches({ fs, dir })) console.log(b === current ? `* \x1b[32m${b}\x1b[0m` : `  ${b}`);
    return 0;
  },

  async checkout(args) {
    const dir = await findRoot();
    const create = takeFlag(args, '-b');
    const ref = args.find((a) => !a.startsWith('-'));
    if (!ref) throw new GitError('usage: git checkout [-b] <branch>');
    if (create) await git.branch({ fs, dir, ref, checkout: true });
    else await git.checkout({ fs, dir, ref });
    console.log(`Switched to ${create ? 'a new ' : ''}branch '${ref}'`);
    return 0;
  },

  async remote(args) {
    const dir = await findRoot();
    if (args[0] === 'add') {
      const [, remote, url] = args;
      if (!remote || !url) throw new GitError('usage: git remote add <name> <url>');
      await git.addRemote({ fs, dir, remote, url });
      return 0;
    }
    const verbose = takeFlag(args, '-v');
    for (const { remote, url } of await git.listRemotes({ fs, dir })) {
      console.log(verbose ? `${remote}\t${url} (fetch)\n${remote}\t${url} (push)` : remote);
    }
    return 0;
  },

  async push(args) {
    const dir = await findRoot();
    takeFlag(args, '-u', '--set-upstream');
    const [remote = 'origin', ref = (await git.currentBranch({ fs, dir })) ?? undefined] = args.filter((a) => !a.startsWith('-'));
    let result;
    try {
      result = await git.push({ fs, http, dir, remote, ref, onAuth, onAuthFailure, onProgress });
    } catch (e) {
      // isomorphic-git's own message suggests its `force` option, which this CLI doesn't have.
      if (e && e.code === 'PushRejectedError') throw new GitError(`${remote} has commits you don't have: run git pull, then push again`);
      throw e;
    }
    endProgress();
    if (!result.ok) throw new GitError(result.error || 'push failed');
    let rejected = false;
    for (const [name, r] of Object.entries(result.refs)) {
      console.log(r.ok ? `${name}: pushed to ${remote}` : `${name}: rejected (${r.error})`);
      if (!r.ok) rejected = true;
    }
    return rejected ? 1 : 0;
  },

  async pull(args) {
    const dir = await findRoot();
    const [remote = 'origin', ref] = args.filter((a) => !a.startsWith('-'));
    await git.pull({
      fs,
      http,
      dir,
      remote,
      ref,
      singleBranch: true,
      author: author(),
      onAuth: canAuth() ? onAuth : undefined,
      onAuthFailure,
      onProgress,
    });
    endProgress();
    console.log('Already up to date or merged.');
    return 0;
  },
};

// The index stores blob ids; readBlob needs one to read a staged version.
async function indexOid(dir, filepath) {
  let found;
  await git.walk({
    fs,
    dir,
    trees: [git.STAGE()],
    map: async (p, [entry]) => {
      if (p === filepath && entry) found = await entry.oid();
      return p === '.' || filepath.startsWith(`${p}/`) || p === filepath ? true : null;
    },
  });
  if (!found) throw new Error('not in index');
  return found;
}

async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (command === '--version' || command === 'version') {
    console.log(`git version isomorphic-git ${git.version()} (Tide)`);
    return 0;
  }
  // JSON commands for Git Pro's screens; see ui.js.
  if (command === '__tide') return createUi({ git, http, findRoot, changes, author, onAuth, onAuthFailure, GitError })(rest);
  const run = Object.prototype.hasOwnProperty.call(commands, command) ? commands[command] : null;
  if (!run) {
    console.error(`git ${command}: not available locally.\n\n${USAGE}`);
    return 1;
  }
  return run(rest);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    endProgress();
    const message = err instanceof GitError ? err.message : err && err.message ? err.message : String(err);
    console.error(`fatal: ${message}`);
    process.exitCode = 128;
  },
);
