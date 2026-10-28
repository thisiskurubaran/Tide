// @ts-check
// Turns isomorphic-git's statusMatrix rows into `git status --porcelain` codes.
'use strict';

/**
 * @param {[string, number, number, number]} row [path, HEAD, WORKDIR, STAGE]
 * @returns {string | null} two-letter code, or null when unchanged
 */
function porcelainCode([, head, workdir, stage]) {
  if (head === 0) {
    if (stage === 0) return workdir === 0 ? null : '??';
    if (workdir === 0) return 'AD';
    return stage === 2 ? 'A ' : 'AM';
  }
  if (workdir === 0) return stage === 0 ? 'D ' : ' D';
  if (stage === 0) return 'D ';
  if (stage === 1) return workdir === 1 ? null : ' M';
  if (stage === 2) return workdir === 2 ? 'M ' : 'MM';
  return 'MM';
}

module.exports = { porcelainCode };
