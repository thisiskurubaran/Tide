// @ts-check
// Three-way merge of text, line by line, as `git merge-file` does: changes on
// one side are taken, the same change on both is taken once, and different
// changes to the same lines become a conflict between <<<<<<< and >>>>>>>.
'use strict';

const { carriedOver } = require('./blame');

/** Lines with their newline, so a missing final newline survives the merge. */
const split = (/** @type {string} */ text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** For each base line, where it is in `side`, or -1 when that side changed it. */
function matches(base, side) {
  const out = new Int32Array(base.length).fill(-1);
  carriedOver(base, side).forEach((b, i) => {
    if (b >= 0) out[b] = i;
  });
  return out;
}

const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) => a.length === b.length && a.every((line, i) => line === b[i]);

// A marker has to start a line, even after a last line without a newline.
const closed = (/** @type {string[]} */ lines) =>
  lines.length && !lines[lines.length - 1].endsWith('\n') ? [...lines.slice(0, -1), `${lines[lines.length - 1]}\n`] : lines;

/**
 * @param {string} baseText
 * @param {string} oursText
 * @param {string} theirsText
 * @param {{ ours?: string, theirs?: string }} [labels] shown after the markers
 * @returns {{ text: string, conflicts: number }}
 */
function merge3(baseText, oursText, theirsText, labels = {}) {
  const base = split(baseText);
  const ours = split(oursText);
  const theirs = split(theirsText);
  const inOurs = matches(base, ours);
  const inTheirs = matches(base, theirs);
  /** @type {string[]} */
  const out = [];
  let conflicts = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  for (;;) {
    // Lines neither side touched.
    while (i < base.length && inOurs[i] === j && inTheirs[i] === k) {
      out.push(base[i]);
      i++;
      j++;
      k++;
    }
    if (i >= base.length && j >= ours.length && k >= theirs.length) break;
    // The next base line both sides kept ends this changed stretch.
    let next = i;
    while (next < base.length && (inOurs[next] < 0 || inTheirs[next] < 0)) next++;
    const j2 = next < base.length ? inOurs[next] : ours.length;
    const k2 = next < base.length ? inTheirs[next] : theirs.length;
    const b = base.slice(i, next);
    const o = ours.slice(j, j2);
    const t = theirs.slice(k, k2);
    if (same(o, b)) out.push(...t);
    else if (same(t, b) || same(o, t)) out.push(...o);
    else {
      conflicts++;
      out.push(`<<<<<<< ${labels.ours ?? 'ours'}\n`, ...closed(o), '=======\n', ...closed(t), `>>>>>>> ${labels.theirs ?? 'theirs'}\n`);
    }
    i = next;
    j = j2;
    k = k2;
  }
  return { text: out.join(''), conflicts };
}

module.exports = { merge3 };
