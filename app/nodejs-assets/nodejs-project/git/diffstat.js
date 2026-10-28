// @ts-check
// Line counts for `git diff --stat`, from the length of the longest common
// subsequence of lines. Files over the limit are reported without counts.
'use strict';

const MAX_LINES = 5000;

/** @param {string} text */
function lines(text) {
  if (!text) return [];
  const out = text.split('\n');
  // A final newline ends the last line; it doesn't start another.
  if (out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * @param {string} a old text
 * @param {string} b new text
 * @returns {{ added: number, removed: number } | null}
 */
function lineStat(a, b) {
  const x = lines(a);
  const y = lines(b);
  if (x.length > MAX_LINES || y.length > MAX_LINES) return null;
  // Trim the common head and tail first; most edits are small.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const xs = x.slice(start, endX);
  const ys = y.slice(start, endY);
  let prev = new Uint32Array(ys.length + 1);
  let cur = new Uint32Array(ys.length + 1);
  for (let i = 1; i <= xs.length; i++) {
    for (let j = 1; j <= ys.length; j++) {
      cur[j] = xs[i - 1] === ys[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const common = prev[ys.length];
  return { added: ys.length - common, removed: xs.length - common };
}

module.exports = { lineStat };
