// @ts-check
// `git stash`, written so real git can read and apply the stashes. isomorphic-git
// 1.44 has a stash, but its commits have a different shape (a third parent that
// real git takes for untracked files), it needs user.name in the git config, and
// apply overwrites files instead of merging. So, like real git:
//
//   W  "WIP on main: abc1234 subject"   tree: the working tree; parents HEAD, I (, U)
//   I  "index on main: ..."             tree: the index; parent HEAD
//   U  "untracked files on main: ..."   tree: untracked files only (with -u)
//
// refs/stash points at the newest W and logs/refs/stash lists them all, oldest
// first: stash@{0} is the last line.
'use strict';

const fs = require('fs');
const path = require('path');

const { conflicts } = require('./state');
const { lstatWork, GITLINK } = require('./tree');

const ZERO = '0'.repeat(40);
const LOG = path.join('logs', 'refs', 'stash');

const subject = (/** @type {string} */ message) => message.split('\n')[0];

/**
 * @param {{ git: any, author(): { name: string, email: string }, changes(dir: string, paths?: string[]): Promise<any[]>,
 *   GitError: any, tree: ReturnType<typeof import('./tree').createTree> }} deps
 */
function createStash({ git, author, changes, GitError, tree }) {
  const logPath = (dir) => path.join(dir, '.git', LOG);

  /** Reflog lines, oldest first. */
  function readLog(dir) {
    let text = '';
    try {
      text = fs.readFileSync(logPath(dir), 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .map((line) => /^([0-9a-f]{40}) ([0-9a-f]{40}) (.*?)\t(.*)$/.exec(line))
      .filter((m) => !!m)
      .map((m) => ({ who: /** @type {string[]} */ (m)[3], oid: /** @type {string[]} */ (m)[2], message: /** @type {string[]} */ (m)[4] }));
  }

  /** @param {{ who: string, oid: string, message: string }[]} entries oldest first */
  async function writeLog(dir, entries) {
    if (!entries.length) {
      fs.rmSync(logPath(dir), { force: true });
      await git.deleteRef({ fs, dir, ref: 'refs/stash' }).catch(() => undefined);
      return;
    }
    // Each line starts with the one before it, as reflogs do.
    const text = entries.map((e, i) => `${i ? entries[i - 1].oid : ZERO} ${e.oid} ${e.who}\t${e.message}\n`).join('');
    fs.mkdirSync(path.dirname(logPath(dir)), { recursive: true });
    fs.writeFileSync(logPath(dir), text);
    await git.writeRef({ fs, dir, ref: 'refs/stash', value: entries[entries.length - 1].oid, force: true });
  }

  /** Stashes, newest first, as `git stash list` shows them. */
  function list(dir) {
    return readLog(dir)
      .reverse()
      .map((e, index) => ({ index, oid: e.oid, message: e.message }));
  }

  function entry(dir, /** @type {number} */ n) {
    const all = list(dir);
    if (!all.length) throw new GitError('no stash entries');
    const e = all[n];
    if (!e) throw new GitError(`stash@{${n}} doesn't exist (there ${all.length === 1 ? 'is 1 stash' : `are ${all.length} stashes`})`);
    return e;
  }

  // A file in the working tree as a blob, with the mode git would give it.
  async function hashFile(dir, filepath) {
    const abs = path.join(dir, filepath);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return { oid: await git.writeBlob({ fs, dir, blob: Buffer.from(fs.readlinkSync(abs)) }), mode: 0o120000 };
    return { oid: await git.writeBlob({ fs, dir, blob: fs.readFileSync(abs) }), mode: st.mode & 0o111 ? 0o100755 : 0o100644 };
  }

  function timezone(date = new Date()) {
    const off = -date.getTimezoneOffset();
    const abs = Math.abs(off);
    return `${off < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
  }

  /**
   * Saves local changes and puts the files back to HEAD.
   * @returns {Promise<{ oid: string, message: string } | null>} null when there was nothing to save
   */
  async function push(dir, { message = '', untracked = false } = {}) {
    if (conflicts(dir).length) throw new GitError(`resolve the conflicts in ${conflicts(dir).join(', ')} first`);
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
    if (!head) throw new GitError('there are no commits yet: make one before stashing');
    const branch = (await git.currentBranch({ fs, dir })) ?? '(no branch)';
    const { commit } = await git.readCommit({ fs, dir, oid: head });
    const on = `${branch}: ${head.slice(0, 7)} ${subject(commit.message)}`;
    const all = await changes(dir);
    const tracked = all.filter((c) => c.code !== '??');
    const extra = untracked ? all.filter((c) => c.code === '??') : [];
    // As in real git, submodule changes alone are nothing to save; with other
    // changes, a staged submodule move is saved in the index commit and
    // undone with the rest.
    if (!tracked.some((c) => !c.gitlink) && !extra.length) return null;

    const me = author();
    const make = async (/** @type {string} */ msg, /** @type {Map<string, any>} */ files, /** @type {string[]} */ parent) =>
      /** @type {Promise<string>} */ (
        git.commit({ fs, dir, message: `${msg}\n`, tree: await tree.writeTree(dir, files), parent, author: me, committer: me, noUpdateBranch: true })
      );
    const index = await tree.indexFiles(dir);
    const i = await make(`index on ${on}`, index, [head]);
    // The working tree's version of every tracked file. That includes one in
    // HEAD but taken out of the index (`git rm --cached`) and still on disk:
    // the restore below puts HEAD's copy back, so its edits must be saved
    // here, as real git saves them.
    const work = new Map(index);
    for (const c of tracked) {
      // A submodule is saved as the index has it; its folder isn't touched.
      if (c.gitlink) continue;
      // lstat, so a symlink whose target is gone is still saved as the link.
      if (lstatWork(dir, c.path)) work.set(c.path, await hashFile(dir, c.path));
      else work.delete(c.path);
    }
    const parents = [head, i];
    if (extra.length) {
      const files = new Map();
      for (const c of extra) files.set(c.path, await hashFile(dir, c.path));
      parents.push(await make(`untracked files on ${on}`, files, []));
    }
    const title = message.trim() ? `On ${branch}: ${message.trim()}` : `WIP on ${on}`;
    const w = await make(title, work, parents);
    const who = `${me.name} <${me.email}> ${Math.floor(Date.now() / 1000)} ${timezone()}`;
    await writeLog(dir, [...readLog(dir), { who, oid: w, message: title }]);

    // Back to HEAD, like `git reset --hard`, and the stashed untracked files go.
    await tree.restore(dir, head, tracked.map((c) => c.path));
    for (const c of extra) tree.removeFile(dir, c.path);
    return { oid: w, message: title };
  }

  /**
   * Merges a stash's changes into the working tree. As in real git, changed
   * files come back unstaged and new files staged.
   * @returns {Promise<{ conflicts: string[], files: string[] }>}
   */
  async function apply(dir, n = 0) {
    const { oid } = entry(dir, n);
    const { commit } = await git.readCommit({ fs, dir, oid });
    const [base, , untrackedCommit] = commit.parent;
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const untrackedFiles = untrackedCommit ? await tree.files(dir, untrackedCommit) : new Map();
    for (const filepath of untrackedFiles.keys()) {
      if (lstatWork(dir, filepath)) throw new GitError(`${filepath} already exists; move it before applying this stash`);
    }
    const r = await tree.applyChange(dir, { base, ours: head, theirs: oid, labels: { ours: 'Updated upstream', theirs: 'Stashed changes' } });
    const inHead = await tree.files(dir, head);
    const inStash = await tree.files(dir, oid);
    // A file whose folder the stash made a file (x/a, now that x is one) can't
    // be in the index beside it: it stays deleted there, as real git leaves it.
    const fileAbove = (/** @type {string} */ p) => {
      for (let d = path.posix.dirname(p); d !== '.'; d = path.posix.dirname(d)) if (inStash.has(d)) return true;
      return false;
    };
    for (const filepath of r.changed) {
      if (!inHead.has(filepath) || r.conflicts.includes(filepath)) continue;
      if (!inStash.has(filepath) && fileAbove(filepath)) continue;
      await tree.resetPath(dir, filepath);
    }
    for (const [filepath, e] of untrackedFiles) tree.writeFile(dir, filepath, await tree.blob(dir, e.oid), e.mode);
    return { conflicts: r.conflicts, files: [...r.changed, ...untrackedFiles.keys()] };
  }

  async function drop(dir, n = 0) {
    const e = entry(dir, n);
    const kept = readLog(dir)
      .reverse()
      .filter((_, i) => i !== n)
      .reverse();
    await writeLog(dir, kept);
    return e;
  }

  /** Applies, then drops the stash unless there were conflicts (real git keeps it then too). */
  async function pop(dir, n = 0) {
    const r = await apply(dir, n);
    if (!r.conflicts.length) await drop(dir, n);
    return { ...r, dropped: !r.conflicts.length };
  }

  async function clear(dir) {
    await writeLog(dir, []);
  }

  /** What a stash changed, against the commit it was made on. */
  async function show(dir, n = 0) {
    const { oid } = entry(dir, n);
    const { commit } = await git.readCommit({ fs, dir, oid });
    const [before, after] = [await tree.files(dir, commit.parent[0]), await tree.files(dir, oid)];
    if (commit.parent[2]) for (const [p, e] of await tree.files(dir, commit.parent[2])) after.set(p, e);
    /** @type {{ path: string, status: 'added' | 'deleted' | 'modified', before: string | null, after: string | null, beforeGitlink: boolean, afterGitlink: boolean }[]} */
    const files = [];
    for (const p of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(p);
      const b = after.get(p);
      if (a && b && a.oid === b.oid && a.mode === b.mode) continue;
      files.push({
        path: p,
        status: !a ? 'added' : !b ? 'deleted' : 'modified',
        before: a ? a.oid : null,
        after: b ? b.oid : null,
        beforeGitlink: !!a && a.mode === GITLINK,
        afterGitlink: !!b && b.mode === GITLINK,
      });
    }
    return files;
  }

  /** Parses `stash@{n}` or `n`; no argument is the newest. */
  function index(/** @type {string | undefined} */ arg) {
    if (arg === undefined) return 0;
    const m = /^(?:stash@\{(\d+)\}|(\d+))$/.exec(arg);
    if (!m) throw new GitError(`${arg} is not a stash (use stash@{n} or n)`);
    return Number(m[1] ?? m[2]);
  }

  return { push, list, apply, pop, drop, clear, show, index };
}

module.exports = { createStash };
