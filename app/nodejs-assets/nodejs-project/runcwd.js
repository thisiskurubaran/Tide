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
//  - Paths Node echoes back (err.path, error messages, mkdtemp and mkdir
//    results, Dirent.parentPath, Dir.path) are shown as the caller gave them,
//    not as the absolute path the call really used.
//  - worker_threads Workers the script starts get the same setup, in the
//    run's current folder (see patchWorker).
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
   * Turns paths in a result or error back into the form the caller gave:
   * relative paths were made absolute against the run's folder before the
   * real call, and Node echoes them (err.path, error messages, mkdtemp's and
   * mkdir's results, Dirent.parentPath), where it would show them as given.
   * @param {[string, string][]} pairs [absolute, as given] for each changed path
   */
  const unfixer = (pairs) => {
    /** @param {unknown} s */
    const back = (s) => {
      if (typeof s !== 'string') return s;
      for (const [abs, given] of pairs) {
        if (s === abs) return given;
        if (s.startsWith(`${abs}/`)) return path.join(given, s.slice(abs.length + 1));
      }
      return s;
    };
    /** @param {any} e */
    const error = (e) => {
      if (!e || typeof e !== 'object') return e;
      try {
        if (typeof e.path === 'string') e.path = back(e.path);
        if (typeof e.dest === 'string') e.dest = back(e.dest);
        for (const key of ['message', 'stack']) {
          let text = e[key];
          if (typeof text !== 'string') continue;
          for (const [abs, given] of pairs) text = text.split(`'${abs}'`).join(`'${given}'`);
          if (text !== e[key]) e[key] = text;
        }
      } catch {
        // a frozen or odd error is left as it is
      }
      return e;
    };
    /** @param {any} d */
    const dirent = (d) => {
      if (d && typeof d === 'object' && typeof d.name === 'string') {
        for (const key of ['parentPath', 'path']) {
          const desc = Object.getOwnPropertyDescriptor(d, key);
          if (desc && 'value' in desc && typeof desc.value === 'string') d[key] = back(desc.value);
        }
      }
      return d;
    };
    /** A Dir from opendir: its path and the parentPath of what it reads. @param {any} dir */
    const dirObject = (dir) => {
      if (!dir || typeof dir !== 'object') return dir;
      const given = back(dir.path);
      Object.defineProperty(dir, 'path', { configurable: true, enumerable: false, get: () => given });
      const read = dir.read;
      dir.read = function (/** @type {any[]} */ ...args) {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
          args[args.length - 1] = (/** @type {any} */ err, /** @type {any} */ entry) => cb(error(err), dirent(entry));
          return read.apply(this, args);
        }
        return read.apply(this, args).then(dirent, (/** @type {any} */ err) => Promise.reject(error(err)));
      };
      const readSync = dir.readSync;
      dir.readSync = function () {
        try {
          return dirent(readSync.call(this));
        } catch (err) {
          throw error(err);
        }
      };
      const entries = dir.entries || dir[Symbol.asyncIterator];
      if (typeof entries === 'function') {
        const mapped = async function* () {
          // @ts-ignore
          for await (const entry of entries.call(this)) yield dirent(entry);
        };
        dir.entries = mapped;
        dir[Symbol.asyncIterator] = mapped;
      }
      return dir;
    };
    /** @param {unknown} s */
    const prefixed = (s) => {
      if (typeof s !== 'string') return s;
      const [abs, given] = pairs[0];
      return s.startsWith(abs) ? given + s.slice(abs.length) : s;
    };
    /** @param {unknown} s */
    const ancestor = (s) => {
      if (typeof s !== 'string') return s;
      const [abs, given] = pairs[0];
      if (s === abs) return given;
      if (!abs.startsWith(`${s}/`)) return s;
      // Drop as many trailing parts from the given path as the result lacks.
      const extra = abs.slice(s.length + 1).split('/').length;
      const parts = path.normalize(given).split('/');
      return parts.slice(0, Math.max(parts.length - extra, 0)).join('/') || '.';
    };
    return { back, error, dirent, dirObject, prefixed, ancestor };
  };

  // What each function returns that holds a path (beyond errors).
  /** @type {Record<string, (u: ReturnType<typeof unfixer>, v: any) => any>} */
  const RESULTS = {
    // The prefix plus random characters.
    mkdtemp: (u, v) => u.prefixed(v),
    // The first folder it created: the given path or one of its parents.
    mkdir: (u, v) => u.ancestor(v),
    readdir: (u, v) => (Array.isArray(v) ? v.map(u.dirent) : v),
    opendir: (u, v) => u.dirObject(v),
  };
  // Callbacks that don't take an error first.
  const NO_ERROR_CALLBACK = new Set(['exists', 'watch', 'watchFile', 'unwatchFile']);

  /**
   * @param {any} target
   * @param {string} name
   * @param {number[]} positions
   */
  const wrap = (target, name, positions) => {
    const original = target[name];
    if (typeof original !== 'function') return;
    const base = name.replace(/Sync$/, '');
    const isSync = name.endsWith('Sync') || target === fs.realpathSync;
    const mapResult = RESULTS[base];
    const wrapped = function (/** @type {any[]} */ ...args) {
      /** @type {[string, string][]} */
      const pairs = [];
      for (const i of positions) {
        const given = args[i];
        args[i] = fix(given);
        if (args[i] !== given && typeof args[i] === 'string') pairs.push([args[i], given]);
        else if (args[i] !== given && Buffer.isBuffer(given)) pairs.push([args[i].toString(), given.toString()]);
      }
      // @ts-ignore keep `this` for methods that use it
      if (!pairs.length) return original.apply(this, args);
      const u = unfixer(pairs);
      const last = args.length - 1;
      if (!isSync && !NO_ERROR_CALLBACK.has(base) && typeof args[last] === 'function') {
        const cb = args[last];
        args[last] = function (/** @type {any} */ err, /** @type {any[]} */ ...rest) {
          if (mapResult && rest.length) rest[0] = mapResult(u, rest[0]);
          // @ts-ignore
          return cb.call(this, u.error(err), ...rest);
        };
      }
      let result;
      try {
        // @ts-ignore keep `this` for methods that use it
        result = original.apply(this, args);
      } catch (err) {
        throw u.error(err);
      }
      if (target === fs.promises && result && typeof result.then === 'function') {
        return result.then(
          (/** @type {any} */ v) => (mapResult ? mapResult(u, v) : v),
          (/** @type {any} */ err) => Promise.reject(u.error(err)),
        );
      }
      if (isSync && mapResult) return mapResult(u, result);
      // Streams report open errors with an 'error' event.
      if ((base === 'createReadStream' || base === 'createWriteStream') && result && typeof result.emit === 'function') {
        const emit = result.emit;
        result.emit = function (/** @type {string} */ event, /** @type {any[]} */ ...rest) {
          if (event === 'error') u.error(rest[0]);
          // Once opened (or failed) the stream no longer needs the absolute path.
          if (event === 'open' || event === 'error') this.path = u.back(this.path);
          return emit.call(this, event, ...rest);
        };
      }
      return result;
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
  patchWorker(() => cwd);
  // `import { readFileSync, spawn } from ...` in ES modules sees the wrappers too.
  require('module').syncBuiltinESMExports();
}

// Workers the script starts get the run's folder too: a new worker is a fresh
// isolate whose process.cwd() is the real one. This file is preloaded into it
// (--require) and the folder rides along in workerData, which the preload
// unwraps (below) before the worker's own code reads it.
const WORKER_KEY = '__tideRunCwd';

/** @param {() => string} getCwd */
function patchWorker(getCwd) {
  const wt = require('worker_threads');
  const Original = wt.Worker;
  if (/** @type {any} */ (Original)[WORKER_KEY]) return;
  const self = __filename;
  class Worker extends Original {
    /**
     * @param {string | URL} filename
     * @param {any} [options]
     */
    constructor(filename, options = {}) {
      const cwd = getCwd();
      const opts = { ...(options || {}) };
      // './w.js' is relative to the run's folder, like it would be to a process's cwd.
      if (!opts.eval && typeof filename === 'string' && /^\.\.?\//.test(filename)) filename = path.resolve(cwd, filename);
      const inherited = Array.isArray(opts.execArgv) ? opts.execArgv : process.execArgv;
      const execArgv = [];
      for (let i = 0; i < inherited.length; i++) {
        if ((inherited[i] === '--require' || inherited[i] === '-r') && inherited[i + 1] === self) i++;
        else execArgv.push(inherited[i]);
      }
      opts.execArgv = [...execArgv, '--require', self];
      opts.workerData = { [WORKER_KEY]: cwd, data: opts.workerData };
      try {
        super(filename, opts);
      } catch (e) {
        // A Node that won't preload into workers: start it as asked, without the run's folder.
        if (!e || /** @type {any} */ (e).code !== 'ERR_WORKER_INVALID_EXEC_ARGV') throw e;
        super(filename, options);
      }
    }
  }
  Object.defineProperty(Worker, 'name', { value: 'Worker' });
  Object.defineProperty(Worker, WORKER_KEY, { value: true });
  wt.Worker = Worker;
}

// Preloaded into a worker started by a run (see patchWorker).
(() => {
  let wt;
  try {
    wt = require('worker_threads');
  } catch {
    return;
  }
  const data = wt.workerData;
  if (wt.isMainThread || !data || typeof data !== 'object' || typeof data[WORKER_KEY] !== 'string') return;
  /** @type {any} */ (wt).workerData = data.data;
  useCwd(data[WORKER_KEY]);
})();

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
