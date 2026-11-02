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

module.exports = { CONFLICTS, gitFile, readGitFile, writeGitFile, removeGitFile, conflicts, setConflicts };
