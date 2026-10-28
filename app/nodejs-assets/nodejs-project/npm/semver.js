// @ts-check
// The subset of semver ranges that package.json files use in practice:
// exact, ^, ~, x/*, comparators (>=, <, ...), hyphen ranges and ||.
// Prerelease versions only match ranges that name a prerelease explicitly.
'use strict';

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** @typedef {{ major: number, minor: number, patch: number, pre: string[] }} Version */

/** @returns {Version | null} */
function parse(v) {
  const m = VERSION.exec(String(v).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** @param {Version} a @param {Version} b */
function compare(a, b) {
  for (const k of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return +x < +y ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * A partial version like "1", "1.2", "1.x" or "*".
 * @returns {{ major: number | null, minor: number | null, patch: number | null, pre: string[] } | null}
 */
function partial(text) {
  const t = text.trim().replace(/^v/, '').replace(/^=/, '');
  if (t === '' || t === '*' || t.toLowerCase() === 'x') return { major: null, minor: null, patch: null, pre: [] };
  const m = /^(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(t);
  if (!m) return null;
  const num = (s) => (s === undefined || /^[xX*]$/.test(s) ? null : +s);
  return { major: num(m[1]), minor: num(m[2]), patch: num(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

const v = (major, minor, patch, pre = []) => ({ major, minor, patch, pre });

/**
 * Turns one comparator set ("^1.2.3", ">=1 <2", "1.2 - 1.4") into [op, version] pairs.
 * @returns {[string, Version][] | null}
 */
function comparators(set) {
  const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(set);
  if (hyphen) {
    const lo = partial(hyphen[1]);
    const hi = partial(hyphen[2]);
    if (!lo || !hi) return null;
    /** @type {[string, Version][]} */
    const out = [['>=', v(lo.major ?? 0, lo.minor ?? 0, lo.patch ?? 0, lo.pre)]];
    if (hi.major === null) return out;
    if (hi.minor === null) out.push(['<', v(hi.major + 1, 0, 0)]);
    else if (hi.patch === null) out.push(['<', v(hi.major, hi.minor + 1, 0)]);
    else out.push(['<=', v(hi.major, hi.minor, hi.patch, hi.pre)]);
    return out;
  }

  /** @type {[string, Version][]} */
  const out = [];
  const parts = set.trim().replace(/(>=|<=|>|<|=|\^|~>?)\s+/g, '$1').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=|\^|~>?)?(.*)$/.exec(part);
    if (!m) return null;
    const op = m[1] || '';
    const p = partial(m[2]);
    if (!p) return null;
    const { major, minor, patch, pre } = p;
    if (major === null) {
      if (op === '<' || op === '>') out.push(['<', v(0, 0, 0)]);
      continue;
    }
    if (op === '^') {
      out.push(['>=', v(major, minor ?? 0, patch ?? 0, pre)]);
      if (major > 0 || minor === null) out.push(['<', v(major + 1, 0, 0)]);
      else if (minor > 0 || patch === null) out.push(['<', v(0, minor + 1, 0)]);
      else out.push(['<', v(0, 0, patch + 1)]);
    } else if (op === '~' || op === '~>') {
      out.push(['>=', v(major, minor ?? 0, patch ?? 0, pre)]);
      out.push(['<', minor === null ? v(major + 1, 0, 0) : v(major, minor + 1, 0)]);
    } else if (op === '' || op === '=') {
      if (minor === null) out.push(['>=', v(major, 0, 0)], ['<', v(major + 1, 0, 0)]);
      else if (patch === null) out.push(['>=', v(major, minor, 0)], ['<', v(major, minor + 1, 0)]);
      else out.push(['=', v(major, minor, patch, pre)]);
    } else if (op === '>' && (minor === null || patch === null)) {
      out.push(['>=', minor === null ? v(major + 1, 0, 0) : v(major, minor + 1, 0)]);
    } else if (op === '<=' && (minor === null || patch === null)) {
      out.push(['<', minor === null ? v(major + 1, 0, 0) : v(major, minor + 1, 0)]);
    } else {
      out.push([op, v(major, minor ?? 0, patch ?? 0, pre)]);
    }
  }
  return out;
}

/** @param {[string, Version][]} set @param {Version} ver */
function testSet(set, ver) {
  for (const [op, c] of set) {
    const r = compare(ver, c);
    const ok = op === '>=' ? r >= 0 : op === '<=' ? r <= 0 : op === '>' ? r > 0 : op === '<' ? r < 0 : r === 0;
    if (!ok) return false;
  }
  if (ver.pre.length) {
    // 1.2.3-beta only matches if a comparator names a prerelease of 1.2.3.
    return set.some(([, c]) => c.pre.length && c.major === ver.major && c.minor === ver.minor && c.patch === ver.patch);
  }
  return true;
}

function satisfies(version, range) {
  const ver = parse(version);
  if (!ver) return false;
  return String(range || '*')
    .split('||')
    .some((set) => {
      const cs = comparators(set);
      return cs !== null && testSet(cs, ver);
    });
}

function validRange(range) {
  return String(range || '*')
    .split('||')
    .every((set) => comparators(set) !== null);
}

/** Highest version in `versions` that satisfies `range`, or null. */
function maxSatisfying(versions, range) {
  let best = null;
  for (const version of versions) {
    if (!satisfies(version, range)) continue;
    if (best === null || compare(/** @type {Version} */ (parse(version)), /** @type {Version} */ (parse(best))) > 0) best = version;
  }
  return best;
}

module.exports = { parse, compare, satisfies, maxSatisfying, validRange };
