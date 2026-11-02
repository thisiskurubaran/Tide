// @ts-check
// `git cherry-pick` and non-interactive `git rebase`, built on applyChange in
// tree.js. A rebase replays the branch's commits onto the upstream one at a
// time, as cherry-picks. When one conflicts it stops with the markers in the
// files; --continue, --skip and --abort pick it up again, even after the app
// was closed, because the state is kept in .git like real git keeps it:
//
//   CHERRY_PICK_HEAD, ORIG_HEAD, MERGE_MSG     a cherry-pick that stopped
//   rebase-merge/{head-name,onto,orig-head,git-rebase-todo,done,msgnum,end}
//   REBASE_HEAD, MERGE_MSG                     the rebase step that stopped
'use strict';

const fs = require('fs');

const { conflicts, readGitFile, removeGitFile, writeGitFile } = require('./state');

const REBASE = 'rebase-merge';
// Files the stopped step wrote, so --abort and --skip can put them back.
const PICK_FILES = 'TIDE_PICK_FILES';

const subject = (/** @type {string} */ message) => message.split('\n')[0];

/**
 * @typedef {{ oid: string, subject: string }} Pick
 * @typedef {{ status: 'done', commit: string | null, skipped: Pick[] }
 *   | { status: 'conflict', conflicts: string[], current: Pick, step?: number, total?: number }
 *   | { status: 'empty', current: Pick }
 *   | { status: 'up-to-date' | 'fast-forward' }} Result
 */

/**
 * @param {{ git: any, author(): { name: string, email: string }, changes(dir: string, paths?: string[]): Promise<any[]>,
 *   GitError: any, tree: ReturnType<typeof import('./tree').createTree> }} deps
 */
function createSequencer({ git, author, changes, GitError, tree }) {
  const head = (dir) => git.resolveRef({ fs, dir, ref: 'HEAD' });
  const rebaseFile = (name) => `${REBASE}/${name}`;
  const rebasing = (dir) => readGitFile(dir, rebaseFile('head-name')) !== null;
  const picking = (dir) => readGitFile(dir, 'CHERRY_PICK_HEAD') !== null;

  function assertIdle(dir) {
    if (rebasing(dir)) throw new GitError('a rebase is in progress: finish it with git rebase --continue, or --abort');
    if (picking(dir)) throw new GitError('a cherry-pick is in progress: finish it with git cherry-pick --continue, or --abort');
    if (readGitFile(dir, 'MERGE_HEAD')) throw new GitError('a merge is in progress: commit or abort it first');
  }

  const pickFiles = (dir) => /** @type {string[]} */ (JSON.parse(readGitFile(dir, PICK_FILES) ?? '[]'));

  /**
   * Applies one commit's change onto HEAD and commits it with its message and
   * author; the committer is you, as in real git.
   * @returns {Promise<{ commit: string | null, conflicts: string[], current: Pick, message: string }>}
   */
  async function pick(dir, oid) {
    const { commit } = await git.readCommit({ fs, dir, oid });
    const current = { oid, subject: subject(commit.message) };
    if (commit.parent.length > 1) throw new GitError(`${oid.slice(0, 7)} is a merge commit, which can't be cherry-picked here`);
    const r = await tree.applyChange(dir, {
      base: commit.parent[0] ?? null,
      ours: await head(dir),
      theirs: oid,
      labels: { ours: 'HEAD', theirs: `${oid.slice(0, 7)} (${current.subject})` },
    });
    if (r.conflicts.length) {
      writeGitFile(dir, PICK_FILES, JSON.stringify(r.changed));
      writeGitFile(dir, 'MERGE_MSG', commit.message);
      return { commit: null, conflicts: r.conflicts, current, message: commit.message };
    }
    // Nothing left to change: HEAD already has it.
    if (!r.changed.length) return { commit: null, conflicts: [], current, message: commit.message };
    const made = await git.commit({ fs, dir, message: commit.message, author: commit.author, committer: author() });
    return { commit: made, conflicts: [], current, message: commit.message };
  }

  /**
   * Commits what's staged for a step that stopped, as its original author.
   * @returns {Promise<string | null>} null when nothing is left to commit
   */
  async function commitStopped(dir, oid) {
    const unresolved = conflicts(dir);
    if (unresolved.length) throw new GitError(`resolve and stage ${unresolved.join(', ')} first`);
    const list = await changes(dir);
    if (list.some((c) => c.code !== '??' && c.code[1] !== ' ')) throw new GitError('stage or discard your other changes first');
    const staged = list.filter((c) => c.code !== '??' && c.code[0] !== ' ');
    const { commit } = await git.readCommit({ fs, dir, oid });
    const message = readGitFile(dir, 'MERGE_MSG') ? `${readGitFile(dir, 'MERGE_MSG')}\n` : commit.message;
    const made = staged.length ? await git.commit({ fs, dir, message, author: commit.author, committer: author() }) : null;
    removeGitFile(dir, 'MERGE_MSG');
    removeGitFile(dir, PICK_FILES);
    return made;
  }

  // Back to HEAD for the files a stopped step wrote.
  async function undoStopped(dir) {
    await tree.restore(dir, await head(dir), [...new Set([...pickFiles(dir), ...conflicts(dir)])]);
    removeGitFile(dir, 'MERGE_MSG');
    removeGitFile(dir, PICK_FILES);
  }

  /** @returns {Promise<Result>} */
  async function cherryPick(dir, spec) {
    assertIdle(dir);
    const oid = await tree.resolveCommit(dir, spec);
    const before = await head(dir);
    const r = await pick(dir, oid);
    if (r.conflicts.length) {
      writeGitFile(dir, 'CHERRY_PICK_HEAD', oid);
      writeGitFile(dir, 'ORIG_HEAD', before);
      return { status: 'conflict', conflicts: r.conflicts, current: r.current };
    }
    if (!r.commit) return { status: 'empty', current: r.current };
    return { status: 'done', commit: r.commit, skipped: [] };
  }

  /** @returns {Promise<Result>} */
  async function cherryPickContinue(dir) {
    const oid = readGitFile(dir, 'CHERRY_PICK_HEAD');
    if (!oid) throw new GitError('no cherry-pick in progress');
    const made = await commitStopped(dir, oid);
    removeGitFile(dir, 'CHERRY_PICK_HEAD');
    const { commit } = await git.readCommit({ fs, dir, oid });
    return made ? { status: 'done', commit: made, skipped: [] } : { status: 'empty', current: { oid, subject: subject(commit.message) } };
  }

  async function cherryPickAbort(dir) {
    if (!picking(dir)) throw new GitError('no cherry-pick in progress');
    await undoStopped(dir);
    removeGitFile(dir, 'CHERRY_PICK_HEAD');
  }

  const todo = (dir) =>
    (readGitFile(dir, rebaseFile('git-rebase-todo')) ?? '')
      .split('\n')
      .map((line) => /^pick ([0-9a-f]{40})/.exec(line)?.[1])
      .filter((oid) => !!oid);

  /** Replays what's left of the todo list; stops at the first conflict. @returns {Promise<Result>} */
  async function replay(dir, /** @type {Pick[]} */ skipped = []) {
    const total = Number(readGitFile(dir, rebaseFile('end'))) || 0;
    let left = todo(dir);
    while (left.length) {
      const [oid, ...rest] = /** @type {string[]} */ (left);
      // The todo list changes only after the pick, so one that fails (say, a
      // file in the way) can be tried again.
      const r = await pick(dir, oid);
      writeGitFile(dir, rebaseFile('done'), `${readGitFile(dir, rebaseFile('done')) ?? ''}\npick ${oid} ${r.current.subject}`.trim());
      writeGitFile(dir, rebaseFile('git-rebase-todo'), rest.map((o) => `pick ${o}`).join('\n'));
      const step = total - rest.length;
      writeGitFile(dir, rebaseFile('msgnum'), String(step));
      if (r.conflicts.length) {
        writeGitFile(dir, 'REBASE_HEAD', oid);
        return { status: 'conflict', conflicts: r.conflicts, current: r.current, step, total };
      }
      // Already upstream (or emptied by the conflicts before it): dropped, as real git does.
      if (!r.commit) skipped.push(r.current);
      left = rest;
    }
    removeGitFile(dir, REBASE);
    removeGitFile(dir, 'REBASE_HEAD');
    return { status: 'done', commit: await head(dir), skipped };
  }

  /** @returns {Promise<Result>} */
  async function rebase(dir, upstream) {
    assertIdle(dir);
    const branch = await git.currentBranch({ fs, dir });
    if (!branch) throw new GitError('check out a branch before rebasing');
    if ((await changes(dir)).some((c) => c.code !== '??')) throw new GitError('commit or stash your changes before rebasing');
    const ours = await head(dir);
    const onto = await tree.resolveCommit(dir, upstream);
    const [base] = await git.findMergeBase({ fs, dir, oids: [ours, onto] });
    if (base === onto) return { status: 'up-to-date' };
    const ref = `refs/heads/${branch}`;
    if (base === ours) {
      await git.writeRef({ fs, dir, ref, value: onto, force: true });
      await git.checkout({ fs, dir, ref: branch, force: true });
      return { status: 'fast-forward' };
    }
    // The branch's own commits, oldest first. Merge commits are left out, as
    // real git does without --rebase-merges.
    const upstreamHas = new Set((await git.log({ fs, dir, ref: onto })).map((/** @type {any} */ e) => e.oid));
    const picks = (await git.log({ fs, dir, ref: ours }))
      .filter((/** @type {any} */ e) => !upstreamHas.has(e.oid) && e.commit.parent.length === 1)
      .reverse();
    writeGitFile(dir, rebaseFile('head-name'), ref);
    writeGitFile(dir, rebaseFile('onto'), onto);
    writeGitFile(dir, rebaseFile('orig-head'), ours);
    writeGitFile(dir, rebaseFile('end'), String(picks.length));
    writeGitFile(dir, rebaseFile('git-rebase-todo'), picks.map((/** @type {any} */ e) => `pick ${e.oid} ${subject(e.commit.message)}`).join('\n'));
    writeGitFile(dir, 'ORIG_HEAD', ours);
    await git.writeRef({ fs, dir, ref, value: onto, force: true });
    await git.checkout({ fs, dir, ref: branch, force: true });
    return replay(dir);
  }

  function assertRebasing(dir) {
    if (!rebasing(dir)) throw new GitError('no rebase in progress');
  }

  /** @returns {Promise<Result>} */
  async function rebaseContinue(dir) {
    assertRebasing(dir);
    const stopped = readGitFile(dir, 'REBASE_HEAD');
    const skipped = [];
    if (stopped) {
      const made = await commitStopped(dir, stopped);
      if (!made) {
        const { commit } = await git.readCommit({ fs, dir, oid: stopped });
        skipped.push({ oid: stopped, subject: subject(commit.message) });
      }
      removeGitFile(dir, 'REBASE_HEAD');
    }
    return replay(dir, skipped);
  }

  /** @returns {Promise<Result>} */
  async function rebaseSkip(dir) {
    assertRebasing(dir);
    const stopped = readGitFile(dir, 'REBASE_HEAD');
    await undoStopped(dir);
    removeGitFile(dir, 'REBASE_HEAD');
    const skipped = [];
    if (stopped) {
      const { commit } = await git.readCommit({ fs, dir, oid: stopped });
      skipped.push({ oid: stopped, subject: subject(commit.message) });
    }
    return replay(dir, skipped);
  }

  async function rebaseAbort(dir) {
    assertRebasing(dir);
    const ref = /** @type {string} */ (readGitFile(dir, rebaseFile('head-name')));
    const orig = /** @type {string} */ (readGitFile(dir, rebaseFile('orig-head')));
    await undoStopped(dir);
    await git.writeRef({ fs, dir, ref, value: orig, force: true });
    await git.checkout({ fs, dir, ref: ref.replace(/^refs\/heads\//, ''), force: true });
    removeGitFile(dir, REBASE);
    removeGitFile(dir, 'REBASE_HEAD');
  }

  /**
   * What's in progress, for status screens.
   * @returns {Promise<null | { kind: 'rebase', onto: string, branch: string, step: number, total: number, current: Pick | null }
   *   | { kind: 'cherry-pick', current: Pick }>}
   */
  async function progress(dir) {
    const read = async (/** @type {string} */ oid) => ({ oid, subject: subject((await git.readCommit({ fs, dir, oid })).commit.message) });
    if (rebasing(dir)) {
      const stopped = readGitFile(dir, 'REBASE_HEAD');
      return {
        kind: 'rebase',
        onto: /** @type {string} */ (readGitFile(dir, rebaseFile('onto'))),
        branch: (readGitFile(dir, rebaseFile('head-name')) ?? '').replace(/^refs\/heads\//, ''),
        step: Number(readGitFile(dir, rebaseFile('msgnum'))) || 0,
        total: Number(readGitFile(dir, rebaseFile('end'))) || 0,
        current: stopped ? await read(stopped) : null,
      };
    }
    const oid = readGitFile(dir, 'CHERRY_PICK_HEAD');
    return oid ? { kind: 'cherry-pick', current: await read(oid) } : null;
  }

  // A plain `git commit` of a stopped step finishes it, as in real git: the
  // cherry-pick is over, and a rebase goes on from the next commit.
  function committed(dir) {
    if (!picking(dir) && !readGitFile(dir, 'REBASE_HEAD')) return;
    for (const name of ['CHERRY_PICK_HEAD', 'REBASE_HEAD', 'MERGE_MSG', PICK_FILES]) removeGitFile(dir, name);
  }

  return { cherryPick, cherryPickContinue, cherryPickAbort, rebase, rebaseContinue, rebaseSkip, rebaseAbort, progress, rebasing, picking, committed };
}

module.exports = { createSequencer };
