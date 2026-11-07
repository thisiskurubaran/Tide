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
//  - fs and fs.promises resolve relative string paths against the run's folder
//    first, because libuv would otherwise resolve them against the real
//    process cwd, which belongs to nobody in particular.
'use strict';

const fs = require('fs');
const path = require('path');

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
  const fix = (/** @type {unknown} */ p) => (typeof p === 'string' && p !== '' && !path.isAbsolute(p) ? path.join(cwd, p) : p);

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
}

module.exports = { useCwd };
