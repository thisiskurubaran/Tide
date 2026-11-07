// @ts-check
// Line-by-line blame for `git __tide blame`: which commit last changed each
// line. isomorphic-git has file history but no blame, so it's worked out here:
// walk the file's versions from newest to oldest, match lines between each pair
// (LCS on the part that changed), and a line belongs to the newest version
// that doesn't carry it over from the one before.
'use strict';

// The changed middle of two versions, above which lines are matched in order
// instead of by LCS (an n×m table).
const MAX_CELLS = 4_000_000;

/** @param {string} text */
function lines(text) {
  if (!text) return [];
  const out = text.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * For each line of `b`, its index in `a` when it's carried over, else -1.
 * @param {string[]} a older lines
 * @param {string[]} b newer lines
 */
function carriedOver(a, b) {
  const map = new Int32Array(b.length).fill(-1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    map[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    map[endB] = endA;
  }
  const n = endA - start;
  const m = endB - start;
  if (!n || !m) return map;
  if (n * m > MAX_CELLS) {
    // Too big for a table: match equal lines in order.
    let j = start;
    for (let i = start; i < endB && j < endA; i++) {
      let k = j;
      while (k < endA && a[k] !== b[i]) k++;
      if (k < endA) {
        map[i] = k;
        j = k + 1;
      }
    }
    return map;
  }
  // LCS lengths from the end, then walk forward.
  const w = m + 1;
  const len = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] = a[start + i] === b[start + j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      map[start + j] = start + i;
      i++;
      j++;
    } else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
    else j++;
  }
  return map;
}

/**
 * @typedef {{ oid: string | null, text: string }} Version  newest first; oid null for uncommitted changes
 * @param {Version[]} versions
 * @returns {{ oid: string | null, start: number, count: number }[]} runs of lines (1-based) by commit
 */
function blame(versions) {
  if (!versions.length) return [];
  const newest = lines(versions[0].text);
  /** @type {(string | null | undefined)[]} */
  const owner = new Array(newest.length).fill(undefined);
  // Where each of the newest version's lines is in the version being looked at.
  let at = newest.map((_, i) => i);
  let current = newest;
  for (let v = 0; v < versions.length; v++) {
    const older = v + 1 < versions.length ? lines(versions[v + 1].text) : null;
    const map = older ? carriedOver(older, current) : null;
    const next = [];
    for (let line = 0; line < newest.length; line++) {
      if (owner[line] !== undefined) continue;
      const pos = at[line];
      const back = map ? map[pos] : -1;
      if (back < 0) owner[line] = versions[v].oid;
      else next[line] = back;
    }
    if (!older) break;
    at = next;
    current = older;
  }
  const runs = [];
  for (let i = 0; i < owner.length; i++) {
    const oid = owner[i] ?? null;
    const last = runs[runs.length - 1];
    if (last && last.oid === oid) last.count++;
    else runs.push({ oid, start: i + 1, count: 1 });
  }
  return runs;
}

module.exports = { blame, carriedOver, lines };
