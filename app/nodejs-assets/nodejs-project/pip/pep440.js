// @ts-check
// Python version handling (PEP 440): the parts pip needs to pick a release.
'use strict';

const VERSION = /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|rc|c|pre|preview)[-_.]?(\d*))?(?:(?:-(\d+))|(?:[-_.]?(post|rev|r)[-_.]?(\d*)))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;

const PRE = { a: 0, alpha: 0, b: 1, beta: 1, rc: 2, c: 2, pre: 2, preview: 2 };

/** @typedef {{ epoch: number, release: number[], pre: [number, number] | null, post: number | null, dev: number | null }} Version */

/** @returns {Version | null} */
function parse(text) {
  const m = VERSION.exec(String(text).trim().toLowerCase());
  if (!m) return null;
  return {
    epoch: m[1] ? +m[1] : 0,
    release: m[2].split('.').map(Number),
    pre: m[3] ? [PRE[/** @type {keyof typeof PRE} */ (m[3])], +(m[4] || 0)] : null,
    post: m[5] !== undefined ? +m[5] : m[6] ? +(m[7] || 0) : null,
    dev: m[8] ? +(m[9] || 0) : null,
  };
}

const isPre = (v) => v.pre !== null || v.dev !== null;

/** @param {Version} a @param {Version} b */
function compare(a, b) {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  const n = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < n; i++) {
    const x = a.release[i] || 0;
    const y = b.release[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // Ordering within a release: dev < pre < final < post (PEP 440).
  const key = (v) => [
    v.pre === null && v.post === null && v.dev !== null ? -Infinity : v.pre ? v.pre[0] : Infinity,
    v.pre ? v.pre[1] : 0,
    v.post === null ? -1 : v.post,
    v.dev === null ? Infinity : v.dev,
  ];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

/** @param {Version} v @param {string} op @param {string} target */
function matchOne(v, op, target) {
  if (op === '===') return false;
  const wildcard = target.endsWith('.*');
  const t = parse(wildcard ? target.slice(0, -2) : target);
  if (!t) return false;
  if (wildcard && (op === '==' || op === '!=')) {
    const prefix = t.release;
    const same = v.epoch === t.epoch && prefix.every((n, i) => (v.release[i] || 0) === n);
    return op === '==' ? same : !same;
  }
  const c = compare(v, t);
  switch (op) {
    case '==':
      return c === 0;
    case '!=':
      return c !== 0;
    case '>=':
      return c >= 0;
    case '<=':
      return c <= 0;
    case '>':
      // >1.7 excludes 1.7.post1 (PEP 440).
      return c > 0 && !(v.post !== null && t.post === null && compare({ ...v, post: null }, t) === 0);
    case '<':
      return c < 0 && !(isPre(v) && !isPre(t) && compare({ ...v, pre: null, dev: null }, t) === 0);
    case '~=': {
      if (t.release.length < 2) return false;
      const upper = t.release.slice(0, -1);
      upper[upper.length - 1]++;
      return c >= 0 && compare(v, { epoch: t.epoch, release: upper, pre: null, post: null, dev: -1 }) < 0;
    }
    default:
      return false;
  }
}

/** Parses "a>=1,<2" into [op, version] pairs. */
function specifiers(spec) {
  return String(spec || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(s);
      return m ? [m[1], m[2].trim()] : ['==', s];
    });
}

function satisfies(version, spec) {
  const v = parse(version);
  if (!v) return false;
  const specs = specifiers(spec);
  // Pre-releases only match when a specifier names one, like pip without --pre.
  if (isPre(v) && !specs.some(([, t]) => { const p = parse(t.replace(/\.\*$/, '')); return p && isPre(p); })) return false;
  return specs.every(([op, t]) => matchOne(v, op, t));
}

/** Highest version satisfying `spec`, or null. */
function best(versions, spec) {
  let top = null;
  for (const version of versions) {
    if (!satisfies(version, spec)) continue;
    if (top === null || compare(/** @type {Version} */ (parse(version)), /** @type {Version} */ (parse(top))) > 0) top = version;
  }
  return top;
}

module.exports = { parse, compare, satisfies, best };
