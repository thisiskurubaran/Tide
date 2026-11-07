// @ts-check
// Gives one worker thread its own working directory.
//
// Every run is a worker thread in one Node process, and the process has one real
// cwd. Runs overlap (a terminal program, a Git Pro clone, the format and
// IntelliSense services, ssh...), so the supervisor never chdirs; instead each
// worker calls useCwd() before user code loads:
//  - process.cwd() returns the run's folder, which also covers path.resolve()
//    and everything built on it (require of relative paths, most libraries).
//  - process.chdir() moves only this run's folder (workers can't really chdir).
//  - fs and fs.promises resolve relative paths (strings and Buffers) against
//    the run's folder first, because libuv would otherwise resolve them
//    against the real process cwd, which belongs to nobody in particular (on
//    Android it is '/'). A file: URL is always absolute, so it needs nothing.
//  - child_process spawn, exec, execFile and fork (and their Sync forms) start
//    in the run's folder unless given a cwd, and a relative cwd is relative to
//    it, for the same reason.
'use strict';

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Which arguments of each fs function are paths. Symlink targets (arg 0 of
// symlink) are stored verbatim on purpose: a relative target is relative to
// the link, not to the cwd.
const ONE = [0];
const TWO = [0, 1];
/** @type {Record<string, number[]>} */
const PATH_ARGS = {
  access: ONE,
  appendFile: ONE,
  chmod: ONE,
  chown: ONE,
  lchmod: ONE,
  lchown: ONE,
  lutimes: ONE,
  exists: ONE,
  lstat: ONE,
  stat: ONE,
  statfs: ONE,
  mkdir: ONE,
  mkdtemp: ONE,
  open: ONE,
  openAsBlob: ONE,
  opendir: ONE,
  readdir: ONE,
  readFile: ONE,
  readlink: ONE,
  realpath: ONE,
  rm: ONE,
  rmdir: ONE,
  truncate: ONE,
  unlink: ONE,
  utimes: ONE,
  writeFile: ONE,
  watch: ONE,
  watchFile: ONE,
  unwatchFile: ONE,
  createReadStream: ONE,
  createWriteStream: ONE,
  copyFile: TWO,
  cp: TWO,
  rename: TWO,
  link: TWO,
  symlink: [1],
};

/**
 * @param {string} initial absolute folder the run starts in
 */
function useCwd(initial) {
  let cwd = path.resolve(initial);
  const fix = (/** @type {unknown} */ p) => {
    if (typeof p === 'string') return p !== '' && !path.isAbsolute(p) ? path.join(cwd, p) : p;
    // Bytes stay bytes: a Buffer path needn't be valid UTF-8.
    if (Buffer.isBuffer(p) && p.length && p[0] !== 0x2f) return Buffer.concat([Buffer.from(`${cwd}/`), p]);
    return p;
  };

  Object.defineProperty(process, 'cwd', { configurable: true, writable: true, value: () => cwd });
  Object.defineProperty(process, 'chdir', {
    configurable: true,
    writable: true,
    value: (/** @type {string} */ dir) => {
      const next = path.resolve(cwd, String(dir));
      // Throws ENOENT/ENOTDIR like the real chdir would.
      if (!fs.statSync(next).isDirectory()) {
        throw Object.assign(new Error(`ENOTDIR: not a directory, chdir '${dir}'`), { code: 'ENOTDIR' });
      }
      cwd = next;
      process.env.PWD = cwd;
    },
  });

  /**
   * @param {any} target
   * @param {string} name
   * @param {number[]} positions
   */
  const wrap = (target, name, positions) => {
    const original = target[name];
    if (typeof original !== 'function') return;
    const wrapped = function (/** @type {any[]} */ ...args) {
      for (const i of positions) args[i] = fix(args[i]);
      // @ts-ignore keep `this` for methods that use it
      return original.apply(this, args);
    };
    // Keep extras like realpath.native and promisify.custom (fs.exists).
    for (const key of Reflect.ownKeys(original)) {
      if (key === 'length' || key === 'name' || key === 'prototype') continue;
      try {
        Object.defineProperty(wrapped, key, /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(original, key)));
      } catch {
        // non-configurable leftovers are fine to skip
      }
    }
    target[name] = wrapped;
  };

  for (const [name, positions] of Object.entries(PATH_ARGS)) {
    wrap(fs, name, positions);
    wrap(fs, `${name}Sync`, positions);
    wrap(fs.promises, name, positions);
  }
  if (typeof fs.realpathSync.native === 'function') wrap(fs.realpathSync, 'native', ONE);
  if (typeof fs.realpath.native === 'function') wrap(fs.realpath, 'native', ONE);

  const childProcess = require('child_process');
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const original = /** @type {any} */ (childProcess)[name];
    if (typeof original !== 'function') continue;
    const wrapped = function (/** @type {any[]} */ ...args) {
      // @ts-ignore keep `this`
      return original.apply(this, withCwd(args, () => cwd));
    };
    for (const key of Reflect.ownKeys(original)) {
      if (key === 'length' || key === 'name' || key === 'prototype' || key === promisify.custom) continue;
      try {
        Object.defineProperty(wrapped, key, /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(original, key)));
      } catch {
        // non-configurable leftovers are fine to skip
      }
    }
    // util.promisify(exec) uses exec's own promise version, which calls the
    // unwrapped exec: give it the same default.
    const custom = original[promisify.custom];
    if (typeof custom === 'function') {
      Object.defineProperty(wrapped, promisify.custom, {
        configurable: true,
        value: (/** @type {any[]} */ ...args) => custom(...withCwd(args, () => cwd)),
      });
    }
    /** @type {any} */ (childProcess)[name] = wrapped;
  }
  // `import { readFileSync, spawn } from ...` in ES modules sees the wrappers too.
  require('module').syncBuiltinESMExports();
}

/**
 * The arguments of a child_process call with the options' cwd made absolute
 * against the run's folder, or set to it when missing. Options are the first
 * plain object after the command (and its args array), before any callback;
 * when there is none, one is added where Node looks for it.
 * @param {any[]} args
 * @param {() => string} getCwd
 */
function withCwd(args, getCwd) {
  const cwd = getCwd();
  const out = [...args];
  /** @param {any} cur */
  const resolved = (cur) => {
    if (cur === undefined || cur === null) return cwd;
    if (cur instanceof URL) return cur;
    const s = String(cur);
    return path.isAbsolute(s) ? s : path.resolve(cwd, s);
  };
  for (let i = 1; i < out.length; i++) {
    const a = out[i];
    if (typeof a === 'function') break;
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      out[i] = { ...a, cwd: resolved(a.cwd) };
      return out;
    }
  }
  // No options: put them before the callback, or after the last argument,
  // reusing an undefined/null placeholder (spawn(cmd, args, undefined)).
  let at = out.findIndex((a, i) => i > 0 && typeof a === 'function');
  if (at === -1) at = out.length;
  while (at > 1 && (out[at - 1] === undefined || out[at - 1] === null)) at--;
  if (at < out.length && (out[at] === undefined || out[at] === null)) out[at] = { cwd };
  else out.splice(at, 0, { cwd });
  return out;
}

module.exports = { useCwd, withCwd };
