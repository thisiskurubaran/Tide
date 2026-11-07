// @ts-check
// Files in .git that hold state isomorphic-git doesn't keep: which files have
// unresolved conflicts (until they are staged), and the merge, cherry-pick and
// rebase in progress. They are plain files so that state survives the app
// being closed, and they use real git's names where real git has one.
'use strict';

const fs = require('fs');
const path = require('path');

const CONFLICTS = 'TIDE_CONFLICTS';

const gitFile = (/** @type {string} */ dir, /** @type {string} */ name) => path.join(dir, '.git', name);

/** @returns {string | null} */
function readGitFile(dir, name) {
  try {
    return fs.readFileSync(gitFile(dir, name), 'utf8').trim();
  } catch {
    return null;
  }
}

function writeGitFile(dir, name, text) {
  fs.mkdirSync(path.dirname(gitFile(dir, name)), { recursive: true });
  fs.writeFileSync(gitFile(dir, name), text.endsWith('\n') ? text : `${text}\n`);
}

function removeGitFile(dir, name) {
  fs.rmSync(gitFile(dir, name), { force: true, recursive: true });
}

/** @returns {string[]} */
function conflicts(dir) {
  const raw = readGitFile(dir, CONFLICTS);
  return raw ? JSON.parse(raw) : [];
}

/** @param {string[]} list */
function setConflicts(dir, list) {
  if (list.length) fs.writeFileSync(gitFile(dir, CONFLICTS), JSON.stringify(list));
  else removeGitFile(dir, CONFLICTS);
}

/**
 * Throws, as real git does, when a merge, rebase or cherry-pick hasn't been
 * finished: pulling or switching branches then would mix its half-done
 * result into something else.
 * @param {string} dir
 * @param {'pull' | 'checkout'} what
 * @param {new (message: string) => Error} GitError
 */
function assertNoOperation(dir, what, GitError) {
  const unmerged = conflicts(dir);
  const rebasing = fs.existsSync(gitFile(dir, 'rebase-merge')) || fs.existsSync(gitFile(dir, 'rebase-apply'));
  const picking = readGitFile(dir, 'CHERRY_PICK_HEAD') !== null;
  const merging = readGitFile(dir, 'MERGE_HEAD') !== null;
  if (what === 'pull') {
    if (unmerged.length) {
      throw new GitError(
        `Pulling is not possible because you have unmerged files:\n${unmerged.map((p) => `\t${p}`).join('\n')}\nFix them up in the work tree, and then use 'git add/rm <file>' as appropriate to mark resolution and make a commit.`,
      );
    }
    if (merging) throw new GitError('You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.');
    if (picking) throw new GitError('You have not concluded your cherry-pick (CHERRY_PICK_HEAD exists).\nPlease, commit your changes before you merge.');
    if (rebasing) throw new GitError('A rebase is in progress (rebase-merge exists).\nFinish it with git rebase --continue, or --abort, before you pull.');
    return;
  }
  if (unmerged.length) throw new GitError(`you need to resolve your current index first\n${unmerged.map((p) => `${p}: needs merge`).join('\n')}`);
  if (merging) throw new GitError('cannot switch branch while merging\nCommit the merge, or abort it in Git Pro, first.');
  if (rebasing) throw new GitError('cannot switch branch while rebasing\nFinish it with git rebase --continue, or --abort, first.');
  if (picking) throw new GitError('cannot switch branch while cherry-picking\nFinish it with git cherry-pick --continue, or --abort, first.');
}

module.exports = { CONFLICTS, gitFile, readGitFile, writeGitFile, removeGitFile, conflicts, setConflicts, assertNoOperation };
