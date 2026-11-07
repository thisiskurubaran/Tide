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
const { conflicts: unresolved, readGitFile, setConflicts, assertNoOperation } = require('./state');
const { lineStat } = require('./diffstat');
const { createUi } = require('./ui');
const { createTree, readWork } = require('./tree');
const { createStash } = require('./stash');
const { createSequencer } = require('./sequencer');
const { createCommands } = require('./commands');
const { createAuth } = require('./auth');

const USAGE = `usage: git <command>

  clone <url> [dir]     init                  status [-s]
  add <path>... | -A    rm <path>...          commit [-a] -m <message>
  log [--oneline] [-n N]                      diff [--stat]
  branch [name]         checkout [-b] <branch>
  remote [-v] | remote add <name> <url>
  push [remote] [branch|tag] [--tags]         pull [remote] [branch]
  stash [push [-u] [-m msg] | list | show | apply | pop | drop | clear] [n]
  tag [-l] | tag [-a] <name> [-m msg] [commit] | tag -d <name>
  cherry-pick <commit> | --continue | --abort
  rebase <upstream> | --continue | --skip | --abort

Anything else needs Remote mode, which has the real git.`;

const env = process.env;

class GitError extends Error {}

function author() {
  if (!env.TIDE_GIT_NAME || !env.TIDE_GIT_EMAIL) {
    throw new GitError('set your name and email in Settings, Git before committing');
  }
  return { name: env.TIDE_GIT_NAME, email: env.TIDE_GIT_EMAIL };
}

// The GitHub token from Settings goes to github.com only, and accounts saved
// for other hosts only to that host; nothing is sent over plain http (auth.js).
const { canAuth, onAuth } = createAuth({ env, GitError });

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

/**
 * A git pathspec glob, already relative to the repo root (repoPath), as a
 * RegExp over repo paths. As in git (without :(glob)), * and ? match any
 * characters, / included, and [...] is a character class.
 * @param {string} p
 */
function pathspecRegExp(p) {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if (ch === '[') {
      const close = p.indexOf(']', i + 2);
      if (close === -1) out += '\\[';
      else {
        let body = p.slice(i + 1, close);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        out += `[${body.replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else out += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
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

// lstat: a symlink's own mtime, not its target's (real git tracks the link text).
const seconds = (p) => Math.floor(fs.lstatSync(p).mtimeMs / 1000);

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
    const work = readWork(dir, row[0]);
    if (!work) continue;
    const { oid } = await git.hashBlob({ object: work });
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
    for (const line of await extra.progressLines(dir)) console.log(line);
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
    // Like real git: only files in the index are removed (untracked files and
    // .git are never touched), folders need -r, and a file whose staged or
    // working copy isn't committed needs -f, so rm can't lose work.
    const usage = 'usage: git rm [-r] [-f] [-n] [-q] [--cached] [--] <pathspec>...';
    let cached = false;
    let force = false;
    let recursive = false;
    let quiet = false;
    let dryRun = false;
    let ignoreUnmatch = false;
    const specs = [];
    let onlyPaths = false;
    for (const a of args) {
      if (onlyPaths) specs.push(a);
      else if (a === '--') onlyPaths = true;
      else if (a === '--cached') cached = true;
      else if (a === '--force') force = true;
      else if (a === '--quiet') quiet = true;
      else if (a === '--recursive') recursive = true;
      else if (a === '--dry-run') dryRun = true;
      else if (a === '--ignore-unmatch') ignoreUnmatch = true;
      else if (/^-[rRfqn]+$/.test(a)) {
        if (/[rR]/.test(a)) recursive = true;
        if (a.includes('f')) force = true;
        if (a.includes('q')) quiet = true;
        if (a.includes('n')) dryRun = true;
      } else if (a.startsWith('-')) throw new GitError(`unknown option ${a} (${usage})`);
      else specs.push(a);
    }
    if (!specs.length) throw new GitError(usage);
    const indexed = [...(await tree.indexFiles(dir)).keys()];
    const targets = new Set();
    for (const p of specs) {
      // A glob matches tracked paths as git's pathspecs do: * and ? also match
      // a /, so '*.log' finds logs in every folder below the current one.
      const filepath = repoPath(dir, p);
      const glob = /[*?[]/.test(p) ? pathspecRegExp(filepath) : null;
      const exact = indexed.includes(filepath);
      const matched = glob ? indexed.filter((f) => glob.test(f)) : [];
      const inside = indexed.filter((f) => filepath === '.' || f.startsWith(`${filepath}/`));
      if (!exact && !inside.length && !matched.length) {
        if (ignoreUnmatch) continue;
        throw new GitError(`pathspec '${p}' did not match any files`);
      }
      if (!exact && !matched.length && !recursive) throw new GitError(`not removing '${p}' recursively without -r`);
      if (exact) targets.add(filepath);
      for (const f of matched) targets.add(f);
      if (recursive || !matched.length) for (const f of inside) targets.add(f);
    }
    const list = [...targets].sort();
    // A file with a merge conflict goes without -f, as in real git: deleting
    // it is how a conflict is resolved by deletion.
    const unmerged = new Set(unresolved(dir));
    if (!force) {
      const wanted = new Set(list.filter((p) => !unmerged.has(p)));
      const rows = wanted.size ? (await changes(dir, [...wanted])).filter((c) => wanted.has(c.path)) : [];
      // A deleted working copy loses nothing, so it doesn't count as an edit.
      const staged = rows.filter((c) => c.code[0] !== ' ').map((c) => c.path);
      const edited = rows.filter((c) => c.code[1] === 'M').map((c) => c.path);
      const both = staged.filter((p) => edited.includes(p));
      const refuse = (/** @type {string[]} */ paths, /** @type {string} */ what, /** @type {string} */ hint) => {
        const one = paths.length === 1;
        throw new GitError(`the following file${one ? ' has' : 's have'} ${what}:\n${paths.map((p) => `    ${p}`).join('\n')}\n(${hint})`);
      };
      if (both.length) refuse(both, 'staged content different from both the file and the HEAD', 'use -f to force removal');
      if (!cached && staged.length) refuse(staged, 'changes staged in the index', 'use --cached to keep the file, or -f to force removal');
      if (!cached && edited.length) refuse(edited, 'local modifications', 'use --cached to keep the file, or -f to force removal');
    }
    for (const filepath of list) {
      if (!quiet) console.log(`rm '${filepath}'`);
      if (dryRun) continue;
      await git.remove({ fs, dir, filepath });
      if (!cached) {
        let st = null;
        try {
          st = fs.lstatSync(path.join(dir, filepath));
        } catch {
          // Already gone from the working tree.
        }
        if (st && !st.isDirectory()) tree.removeFile(dir, filepath);
      }
    }
    // Removing a conflicted file resolves its conflict (staged as deleted),
    // like git add does for an edited one; Git Pro stops showing it as UU.
    if (!dryRun && list.some((p) => unmerged.has(p))) {
      const removed = new Set(list);
      setConflicts(dir, [...unmerged].filter((p) => !removed.has(p)));
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
    // As in real git, even with -a: conflict markers mustn't be committed by accident.
    const left = unresolved(dir);
    if (left.length) throw new GitError(`committing is not possible because you have unmerged files: ${left.join(', ')} (fix them, then git add each one)`);
    // A merge started from Git Pro makes this a merge commit, as in real git.
    const merging = readGitFile(dir, 'MERGE_HEAD');
    if (all) {
      for (const c of await changes(dir)) {
        if (c.code === '??') continue;
        if (c.row[2] === 0) await git.remove({ fs, dir, filepath: c.path });
        else await git.add({ fs, dir, filepath: c.path });
      }
    }
    const staged = (await changes(dir)).filter((c) => c.code[0] !== ' ' && c.code !== '??');
    // A merge whose result matches HEAD (conflicts resolved to ours) still
    // records that the branch was merged.
    if (!staged.length && !merging) {
      console.log('nothing to commit (use git add)');
      return 1;
    }
    const parent = merging ? [await git.resolveRef({ fs, dir, ref: 'HEAD' }), merging] : undefined;
    const oid = await git.commit({ fs, dir, message, author: author(), parent });
    if (parent) for (const f of ['MERGE_HEAD', 'MERGE_MSG', 'TIDE_CONFLICTS']) fs.rmSync(path.join(dir, '.git', f), { force: true });
    sequencer.committed(dir);
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
          if (where === 'work') return (readWork(dir, c.path) ?? Buffer.alloc(0)).toString('utf8');
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
    else {
      assertNoOperation(dir, 'checkout', GitError);
      // A branch only on origin becomes a local one tracking it (isomorphic-git does that part).
      const to = (await tree.resolveCommit(dir, ref).catch(() => null)) ?? (await tree.resolveCommit(dir, `refs/remotes/origin/${ref}`).catch(() => null));
      if (!to) throw new GitError(`pathspec '${ref}' did not match any branch`);
      await tree.checkoutSafely(dir, { ref, to });
    }
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
    const setUpstream = takeFlag(args, '-u', '--set-upstream');
    const tags = takeFlag(args, '--tags');
    if (tags) return extra.pushTags(dir, args.find((a) => !a.startsWith('-')) ?? 'origin');
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
    // -u: later pulls (and pushes) of this branch go to the same place.
    const branch = await git.currentBranch({ fs, dir });
    if (setUpstream && !rejected && branch && ref && ref.replace(/^refs\/heads\//, '') === branch) {
      await git.setConfig({ fs, dir, path: `branch.${branch}.remote`, value: remote });
      await git.setConfig({ fs, dir, path: `branch.${branch}.merge`, value: `refs/heads/${branch}` });
      console.log(`branch '${branch}' set up to track '${remote}/${branch}'.`);
    }
    return rejected ? 1 : 0;
  },

  async pull(args) {
    const dir = await findRoot();
    const [remoteArg, ref] = args.filter((a) => !a.startsWith('-'));
    const branch = await git.currentBranch({ fs, dir });
    if (!branch) throw new GitError('check out a branch before pulling');
    assertNoOperation(dir, 'pull', GitError);
    const config = async (/** @type {string} */ key) => {
      const v = await git.getConfig({ fs, dir, path: key }).catch(() => undefined);
      return typeof v === 'string' && v ? v : undefined;
    };
    // Like real git: the branch's upstream (branch.<name>.remote and .merge)
    // says where to pull from when the command line doesn't.
    const upstream = await config(`branch.${branch}.merge`);
    const upstreamRemote = await config(`branch.${branch}.remote`);
    const remote = remoteArg ?? upstreamRemote ?? 'origin';
    let remoteRef = ref ?? (upstream && (!remoteArg || remoteArg === (upstreamRemote ?? 'origin')) ? upstream.replace(/^refs\/heads\//, '') : undefined);
    if (!remoteRef) {
      const unborn = !(await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null));
      if (unborn) remoteRef = await remoteDefaultBranch(dir, remote, branch);
      else if (remoteArg) {
        throw new GitError(
          `You asked to pull from the remote '${remoteArg}', but did not specify a branch. Because this is not the default configured remote for your current branch, you must specify a branch on the command line.`,
        );
      } else {
        throw new GitError(
          `There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\n\n    git pull <remote> <branch>\n\nTo pull from the same place from now on, push this branch with -u once:\n\n    git push -u ${remote} ${branch}`,
        );
      }
    }
    // Fetch first; nothing local changes until the result is known to be safe
    // to check out (isomorphic-git's pull moves the branch, then checks out,
    // and a checkout that fails leaves the branch on the new commit with the
    // old files).
    const fetched = await git.fetch({
      fs,
      http,
      dir,
      remote,
      ref: remoteRef,
      singleBranch: true,
      onAuth: canAuth() ? onAuth : undefined,
      onAuthFailure,
      onProgress,
    });
    endProgress();
    const theirs = fetched.fetchHead;
    if (!theirs) throw new GitError(`couldn't find remote ref ${remoteRef}`);
    const ours = await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
    let to = theirs;
    let how = 'Fast-forward';
    if (ours) {
      const [base] = await git.findMergeBase({ fs, dir, oids: [ours, theirs] });
      if (ours === theirs || base === theirs) {
        console.log('Already up to date.');
        return 0;
      }
      if (base !== ours) {
        const url = (await git.getConfig({ fs, dir, path: `remote.${remote}.url` }).catch(() => undefined)) ?? remote;
        try {
          // Writes the merge commit but leaves the branch where it is.
          const merged = await git.merge({
            fs,
            dir,
            ours: branch,
            theirs,
            author: author(),
            message: `Merge branch '${remoteRef}' of ${url} into ${branch}`,
            noUpdateBranch: true,
          });
          to = merged.oid;
        } catch (e) {
          const err = /** @type {any} */ (e);
          if (err && err.code === 'MergeConflictError') {
            const files = (err.data && err.data.filepaths) || [];
            throw new GitError(`merging ${remote}/${remoteRef} conflicts in ${files.join(', ') || 'some files'}; nothing was changed. Merge ${remote}/${remoteRef} from Git Pro to resolve the conflicts.`);
          }
          throw e;
        }
        how = 'Merge made';
      }
    }
    await tree.checkoutSafely(dir, { ref: branch, to, what: 'pull', move: `refs/heads/${branch}` });
    console.log(`${how}: ${branch} is now at ${to.slice(0, 7)}`);
    return 0;
  },
};

/**
 * What to pull into an unborn branch with no upstream: the remote's branch of
 * the same name, which must be its default branch. When the remote's default
 * is named differently (master and main), says so instead of failing to find
 * a branch the remote doesn't have.
 */
async function remoteDefaultBranch(dir, remote, branch) {
  const url = await git.getConfig({ fs, dir, path: `remote.${remote}.url` }).catch(() => undefined);
  if (!url) throw new GitError(`'${remote}' does not appear to be a git repository (add it with git remote add ${remote} <url>)`);
  const info = await git.getRemoteInfo({ http, url, onAuth: canAuth() ? onAuth : undefined, onAuthFailure });
  const head = typeof info.HEAD === 'string' ? info.HEAD.replace(/^refs\/heads\//, '') : null;
  if (!head || head === branch) return branch;
  throw new GitError(
    `your branch '${branch}' has no commits yet, and ${remote}'s default branch is '${head}', not '${branch}'.\nRun git pull ${remote} ${head} to start ${branch} from it.`,
  );
}

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

const tree = createTree({ git, changes, GitError });
const stash = createStash({ git, author, changes, GitError, tree });
const sequencer = createSequencer({ git, author, changes, GitError, tree });
const extra = createCommands({ git, http, author, onAuth, onAuthFailure, GitError, findRoot, takeFlag, takeValue, stash, sequencer, tree });
const { stash: stashCommand, tag, 'cherry-pick': cherryPick, rebase } = extra;
Object.assign(commands, { stash: stashCommand, tag, 'cherry-pick': cherryPick, rebase });

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
  if (command === '__tide') return createUi({ git, http, findRoot, changes, author, onAuth, onAuthFailure, GitError, tree, stash, sequencer })(rest);
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
