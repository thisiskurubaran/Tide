// @ts-check
// Tree-level helpers for stash, cherry-pick and rebase. isomorphic-git merges
// only branches (it finds the merge base itself), so applying "the change from
// commit A to commit B" onto HEAD is done here, file by file, straight into the
// working tree and index the way real git leaves them.
'use strict';

const fs = require('fs');
const path = require('path');

const { merge3 } = require('./merge3');
const { conflicts, setConflicts } = require('./state');

/** @typedef {{ oid: string, mode: number }} Entry */

// A submodule: the tree records its commit, and the working tree has a folder
// (empty until the submodule is set up, which this git doesn't do).
const GITLINK = 0o160000;
const SYMLINK = 0o120000;

/** @param {Buffer | Uint8Array} buf */
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

const sameEntry = (/** @type {Entry | null} */ a, /** @type {Entry | null} */ b) => (!a || !b ? a === b : a.oid === b.oid && a.mode === b.mode);

/** lstat of a working tree path, or null when nothing is there. Never follows a symlink. */
function lstatWork(/** @type {string} */ dir, /** @type {string} */ filepath) {
  try {
    return fs.lstatSync(path.join(dir, filepath));
  } catch {
    return null;
  }
}

/**
 * A working tree file's content as git stores it, or null when it isn't there:
 * a symlink is the text of its target (mode 120000), never what it points at,
 * so a link to a folder or to a changing file reads the same as real git.
 * @returns {Buffer | null}
 */
function readWork(/** @type {string} */ dir, /** @type {string} */ filepath) {
  const st = lstatWork(dir, filepath);
  if (!st || st.isDirectory()) return null;
  const abs = path.join(dir, filepath);
  return st.isSymbolicLink() ? Buffer.from(fs.readlinkSync(abs)) : fs.readFileSync(abs);
}

/** @param {{ git: any, changes(dir: string, paths?: string[]): Promise<any[]>, GitError: any }} deps */
function createTree({ git, changes, GitError }) {
  async function blob(dir, oid) {
    return Buffer.from((await git.readBlob({ fs, dir, oid })).blob);
  }

  /** A walked entry as a file or submodule (gitlink), or null for a folder. @returns {Promise<Entry | null>} */
  async function fileEntry(/** @type {any} */ e) {
    if (!e) return null;
    const type = await e.type();
    return type === 'blob' || type === 'commit' ? { oid: await e.oid(), mode: await e.mode() } : null;
  }

  /** Every file and submodule (gitlink) in a commit's tree. @returns {Promise<Map<string, Entry>>} */
  async function files(dir, commit) {
    const out = new Map();
    await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref: commit })],
      map: async (/** @type {string} */ filepath, /** @type {any[]} */ [e]) => {
        if (filepath === '.' || !e) return true;
        const entry = await fileEntry(e);
        if (entry) out.set(filepath, entry);
        return true;
      },
    });
    return out;
  }

  /** Writes nested tree objects for a flat list of files. @param {Map<string, Entry>} entries */
  async function writeTree(dir, entries) {
    /** @typedef {Map<string, Entry | Folder>} Folder */
    /** @type {Folder} */
    const root = new Map();
    for (const [filepath, entry] of entries) {
      const parts = filepath.split('/');
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!(node.get(part) instanceof Map)) node.set(part, new Map());
        node = /** @type {Folder} */ (node.get(part));
      }
      node.set(parts[parts.length - 1], entry);
    }
    /** @param {Folder} node @returns {Promise<string>} */
    const write = async (node) => {
      const tree = [];
      for (const [name, v] of node) {
        if (v instanceof Map) tree.push({ mode: '040000', path: name, oid: await write(v), type: 'tree' });
        else tree.push({ mode: v.mode.toString(8).padStart(6, '0'), path: name, oid: v.oid, type: v.mode === 0o160000 ? 'commit' : 'blob' });
      }
      return git.writeTree({ fs, dir, tree });
    };
    return write(root);
  }

  /** The index as a flat list of files and submodules (gitlinks). @returns {Promise<Map<string, Entry>>} */
  async function indexFiles(dir) {
    const out = new Map();
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE()],
      map: async (/** @type {string} */ filepath, /** @type {any[]} */ [e]) => {
        if (filepath === '.' || !e) return true;
        const entry = await fileEntry(e);
        if (entry) out.set(filepath, entry);
        return true;
      },
    });
    return out;
  }

  /** The first folder above `filepath` that is a symlink or a file in the working tree, or null. */
  function notAFolderAbove(dir, /** @type {string} */ filepath) {
    const parts = filepath.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const st = lstatWork(dir, parts.slice(0, i).join('/'));
      if (!st) return null;
      if (!st.isDirectory()) return parts.slice(0, i).join('/');
    }
    return null;
  }

  // Deleting a file shouldn't leave its empty folders behind, as in real git.
  // Never deletes through a symlink: below a link isn't in the repo. A folder
  // (a submodule's) goes only when it is empty, as real git leaves one in use.
  function removeFile(dir, filepath) {
    if (notAFolderAbove(dir, filepath)) return;
    const st = lstatWork(dir, filepath);
    if (st && st.isDirectory()) {
      try {
        fs.rmdirSync(path.join(dir, filepath));
      } catch {
        return;
      }
    } else if (st) fs.rmSync(path.join(dir, filepath), { force: true });
    let parent = path.dirname(filepath);
    while (parent !== '.' && parent !== '') {
      const abs = path.join(dir, parent);
      try {
        if (fs.readdirSync(abs).length) break;
        fs.rmdirSync(abs);
      } catch {
        break;
      }
      parent = path.dirname(parent);
    }
  }

  /**
   * Puts content into the working tree, as a file of the given mode: a
   * symlink (mode 120000) is made as a link whose target is the content.
   * Whatever is at the path is replaced, never written through, and a path
   * below a symlink is refused, since that would write outside the repo.
   */
  function writeFile(dir, filepath, content, mode) {
    const link = notAFolderAbove(dir, filepath);
    if (link && lstatWork(dir, link)?.isSymbolicLink()) throw new GitError(`${filepath} is beyond the symbolic link ${link}; not writing through it`);
    const abs = path.join(dir, filepath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.rmSync(abs, { force: true });
    if (mode === SYMLINK) {
      fs.symlinkSync(content.toString('utf8'), abs);
      return;
    }
    fs.writeFileSync(abs, content, { flag: 'wx' });
    if (mode === 0o100755) fs.chmodSync(abs, 0o755);
  }

  /** Records a submodule (gitlink) in the index, with an empty folder for it when nothing is there, as real git does. */
  async function putGitlink(dir, filepath, /** @type {Entry} */ entry) {
    const st = lstatWork(dir, filepath);
    if (st && !st.isDirectory()) fs.rmSync(path.join(dir, filepath), { force: true });
    if (!st || !st.isDirectory()) {
      if (!notAFolderAbove(dir, filepath)) fs.mkdirSync(path.join(dir, filepath), { recursive: true });
    }
    await git.updateIndex({ fs, dir, filepath, oid: entry.oid, mode: GITLINK, add: true, force: true });
  }

  /** Makes a file in the working tree and index match an entry, or removes it. */
  async function setFile(dir, filepath, /** @type {Entry | null} */ entry) {
    if (!entry) {
      removeFile(dir, filepath);
      await git.remove({ fs, dir, filepath }).catch(() => undefined);
      return;
    }
    if (entry.mode === GITLINK) {
      await putGitlink(dir, filepath, entry);
      return;
    }
    if (lstatWork(dir, filepath)?.isDirectory()) removeFile(dir, filepath);
    writeFile(dir, filepath, await blob(dir, entry.oid), entry.mode);
    // force: a tracked file is staged even when a .gitignore pattern matches it.
    await git.add({ fs, dir, filepath, force: true });
  }

  /**
   * Applies the change from `base` to `theirs` onto `ours` (HEAD), in the
   * working tree and index. Files both sides changed are merged; a conflict is
   * left in the file with markers and listed in TIDE_CONFLICTS until staged.
   * Refuses, before writing anything, when a file it would touch has local
   * changes or an untracked file is in the way.
   * @param {string} dir
   * @param {{ base: string | null, ours: string, theirs: string, labels: { ours: string, theirs: string } }} opts
   * @returns {Promise<{ changed: string[], conflicts: string[] }>}
   */
  async function applyChange(dir, { base, ours, theirs, labels }) {
    /** @type {{ path: string, b: Entry | null, o: Entry | null, t: Entry | null }[]} */
    const differ = [];
    const trees = [base ? git.TREE({ ref: base }) : null, git.TREE({ ref: ours }), git.TREE({ ref: theirs })];
    const info = fileEntry;
    await git.walk({
      fs,
      dir,
      trees: trees.filter(Boolean),
      map: async (/** @type {string} */ filepath, /** @type {any[]} */ walked) => {
        if (filepath === '.') return true;
        const [b, o, t] = base ? walked : [null, ...walked];
        // A folder or file the change didn't touch needs no look inside.
        if (b && t && (await b.oid()) === (await t.oid()) && (await b.mode()) === (await t.mode())) return null;
        const entry = { path: filepath, b: await info(b), o: await info(o), t: await info(t) };
        if (!sameEntry(entry.b, entry.t)) differ.push(entry);
        return true;
      },
    });
    const todo = differ.filter((e) => !sameEntry(e.o, e.t));
    if (!todo.length) return { changed: [], conflicts: [] };

    const paths = todo.map((e) => e.path);
    const wanted = new Set(paths);
    const inTheWay = (await changes(dir, paths)).filter((c) => wanted.has(c.path)).map((c) => c.path);
    if (inTheWay.length) {
      throw new GitError(`your local changes to ${inTheWay.join(', ')} would be overwritten; commit or stash them first`);
    }

    const conflicted = [];
    const changed = [];
    for (const { path: filepath, b, o, t } of todo) {
      if (sameEntry(o, b)) {
        await setFile(dir, filepath, t);
        changed.push(filepath);
        continue;
      }
      // Both sides changed it.
      if (o && t && (o.mode === GITLINK || t.mode === GITLINK)) {
        // A submodule moved both ways: keep ours, the user picks.
        changed.push(filepath);
        conflicted.push(filepath);
        continue;
      }
      if (o && t) {
        const [bb, ob, tb] = [b ? await blob(dir, b.oid) : Buffer.alloc(0), await blob(dir, o.oid), await blob(dir, t.oid)];
        const mode = o.mode === (b ? b.mode : o.mode) ? t.mode : o.mode;
        if (![bb, ob, tb].some(isBinary)) {
          const merged = merge3(bb.toString('utf8'), ob.toString('utf8'), tb.toString('utf8'), labels);
          // HEAD already has this change.
          if (!merged.conflicts && merged.text === ob.toString('utf8') && mode === o.mode) continue;
          changed.push(filepath);
          writeFile(dir, filepath, Buffer.from(merged.text, 'utf8'), mode);
          if (merged.conflicts) conflicted.push(filepath);
          else await git.add({ fs, dir, filepath });
          continue;
        }
        // Binary on both sides: keep ours, the user picks.
        changed.push(filepath);
        conflicted.push(filepath);
        continue;
      }
      // Changed on one side, deleted on the other: keep the changed file in
      // the working tree; staging it keeps it, deleting it deletes it.
      if (t && t.mode !== GITLINK) writeFile(dir, filepath, await blob(dir, t.oid), t.mode);
      changed.push(filepath);
      conflicted.push(filepath);
    }
    if (conflicted.length) setConflicts(dir, [...new Set([...conflicts(dir), ...conflicted])]);
    return { changed, conflicts: conflicted };
  }

  /** Puts the given files back to how they are in a commit, in the working tree and index. */
  async function restore(dir, commit, /** @type {string[]} */ paths) {
    const all = await files(dir, commit);
    // Removals first, so a file can take the place of a folder that goes.
    const order = [...paths].sort((x, y) => Number(all.has(x)) - Number(all.has(y)) || (x < y ? 1 : -1));
    for (const filepath of order) await setFile(dir, filepath, all.get(filepath) ?? null);
    setConflicts(dir, conflicts(dir).filter((p) => !paths.includes(p)));
  }

  /** @type {Record<string, string>} */
  const ADVICE = {
    checkout: 'switch branches',
    merge: 'merge',
    pull: 'merge',
    rebase: 'rebase',
  };

  /** The entry a working tree file would get if staged, or null when nothing is there. @returns {Promise<Entry | null>} */
  async function workEntry(dir, filepath) {
    const st = lstatWork(dir, filepath);
    if (!st || st.isDirectory()) return null;
    const content = readWork(dir, filepath);
    if (!content) return null;
    const { oid } = await git.hashBlob({ object: content });
    const mode = st.isSymbolicLink() ? 0o120000 : st.mode & 0o111 ? 0o100755 : 0o100644;
    return { oid, mode };
  }

  /** Folders a set of files needs. @param {Map<string, Entry>} entries */
  function foldersOf(entries) {
    const folders = new Set();
    for (const p of entries.keys()) for (let d = path.posix.dirname(p); d !== '.'; d = path.posix.dirname(d)) folders.add(d);
    return folders;
  }

  /**
   * Whether a folder above `p` is a file in `entries`. A submodule (gitlink)
   * doesn't count: its folder holds the submodule's own files, which real git
   * leaves alone.
   * @param {Map<string, Entry>} entries
   */
  function fileAbove(entries, /** @type {string} */ p) {
    for (let d = path.posix.dirname(p); d !== '.'; d = path.posix.dirname(d)) {
      const e = entries.get(d);
      if (e && e.mode !== GITLINK) return true;
    }
    return false;
  }

  /** Whether a folder above `p` is any entry (file, link or submodule) in `entries`. @param {Map<string, Entry>} entries */
  function entryAbove(entries, /** @type {string} */ p) {
    for (let d = path.posix.dirname(p); d !== '.'; d = path.posix.dirname(d)) if (entries.has(d)) return true;
    return false;
  }

  /** Files and links below a working tree folder, never following a link. @returns {string[]} */
  function filesUnder(dir, /** @type {string} */ folder) {
    /** @type {string[]} */
    const out = [];
    const walk = (/** @type {string} */ rel) => {
      let names;
      try {
        names = fs.readdirSync(path.join(dir, rel));
      } catch {
        return;
      }
      for (const name of names) {
        const p = `${rel}/${name}`;
        const st = lstatWork(dir, p);
        if (st && st.isDirectory()) walk(p);
        else if (st) out.push(p);
      }
    };
    walk(folder);
    return out;
  }

  /**
   * What would be lost by moving the working tree and index from commit
   * `from` (HEAD, or null before the first commit) to `to`, as real git checks
   * before it switches: tracked files the switch changes that have staged or
   * unstaged edits (unless the index and working tree already hold what `to`
   * has there), staged files in a folder `to` has as a file, and untracked
   * files at paths `to` tracks (or that a file in `to` needs as a folder, or
   * the other way round). With `base`, only the paths that differ between
   * `base` and `to` count: a merge of `to` leaves the others as they are.
   * @param {string} dir
   * @param {string | null} from
   * @param {string} to
   * @param {{ base?: string | null }} [opts]
   * @returns {Promise<{ differ: string[], local: string[], untracked: string[], before: Map<string, Entry>, after: Map<string, Entry> }>}
   */
  async function switchBlockers(dir, from, to, opts = {}) {
    const before = from ? await files(dir, from) : new Map();
    let after = await files(dir, to);
    let all = [...new Set([...before.keys(), ...after.keys()])];
    if (opts.base !== undefined) {
      const base = opts.base ? await files(dir, opts.base) : new Map();
      const theirs = after;
      all = [...new Set([...base.keys(), ...theirs.keys()])].filter((p) => !sameEntry(base.get(p) ?? null, theirs.get(p) ?? null));
      const touched = new Set(all);
      after = new Map([...theirs].filter(([p]) => touched.has(p)));
    }
    const target = after;
    const differ = all.filter((p) => !sameEntry(before.get(p) ?? null, target.get(p) ?? null)).sort();
    const changing = new Set(differ);
    const folders = foldersOf(after);
    const local = [];
    const untracked = [];
    /** @type {Map<string, Entry> | null} */
    let index = null;
    for (const c of await changes(dir)) {
      if (c.code === '??') {
        if (after.has(c.path) || folders.has(c.path) || fileAbove(after, c.path)) untracked.push(c.path);
      } else if (changing.has(c.path)) {
        // Already what the switch would make it (e.g. `git rm x` when `to` deletes x too).
        index = index ?? (await indexFiles(dir));
        const want = target.get(c.path) ?? null;
        if (sameEntry(index.get(c.path) ?? null, want) && sameEntry(await workEntry(dir, c.path), want)) continue;
        local.push(c.path);
      } else if (!before.has(c.path) && (folders.has(c.path) || fileAbove(after, c.path))) {
        // Staged but not committed, where `to` needs a folder or has a file.
        local.push(c.path);
      }
    }
    return { differ, local: local.sort(), untracked: untracked.sort(), before, after };
  }

  /**
   * Throws, with real git's message, when switching from `from` to `to` would
   * overwrite local changes or untracked files. Returns the paths that differ.
   * @param {'checkout' | 'merge' | 'pull' | 'rebase'} what
   * @param {{ base?: string | null }} [opts] see switchBlockers
   */
  async function assertCanSwitch(dir, from, to, what = 'checkout', opts = {}) {
    const blockers = await switchBlockers(dir, from, to, opts);
    const { local, untracked } = blockers;
    const by = what === 'pull' ? 'merge' : what;
    const list = (/** @type {string[]} */ paths) => paths.map((p) => `\t${p}`).join('\n');
    if (local.length) {
      throw new GitError(
        `Your local changes to the following files would be overwritten by ${by}:\n${list(local)}\nPlease commit your changes or stash them before you ${ADVICE[what]}.`,
      );
    }
    if (untracked.length) {
      throw new GitError(
        `The following untracked working tree files would be overwritten by ${by}:\n${list(untracked)}\nPlease move or remove them before you ${ADVICE[what]}.`,
      );
    }
    return blockers;
  }

  /**
   * Makes the working tree and index hold what `after` has at `paths` (or
   * nothing, where `after` has nothing), coming from `before`, what HEAD has
   * now: a checkout of just those paths. `to` is a commit whose tree has
   * `after`'s entries there. Callers have already refused local changes and
   * untracked files in the way (assertCanSwitch), so this overwrites.
   *
   * Everything that can fail is checked before anything is changed: an
   * untracked file that isn't ignored, or a nested repo, still in a folder
   * that has to become a file, or a symlink where a folder has to be. Ignored
   * files in the way go, as in real git.
   *
   * isomorphic-git's checkout writes the ordinary files. What it can't do is
   * done here: a file that becomes a folder or the other way round (it plans
   * update-blob-to-tree and the like but fails with ENOTDIR, or leaves the
   * index without the file), symlinks (it writes a changed link over the old
   * one and fails), and submodules (gitlinks), whose index entries it
   * mishandles. A submodule's files aren't checked out: its folder is made
   * empty, as real git does before the submodule is set up, and removed only
   * when empty.
   * @param {string} dir
   * @param {Map<string, Entry>} before
   * @param {Map<string, Entry>} after
   * @param {string[]} paths
   * @param {{ to: string, what?: 'checkout' | 'merge' | 'pull' | 'rebase' }} opts
   */
  async function switchFiles(dir, before, after, paths, { to, what = 'checkout' }) {
    const beforeFolders = foldersOf(before);
    const afterFolders = foldersOf(after);
    const odd = (/** @type {Entry | null} */ e) => !!e && (e.mode === GITLINK || e.mode === SYMLINK);
    /** @type {string[]} */
    const plain = [];
    /** @type {string[]} */
    const special = [];
    for (const p of paths) {
      const st = lstatWork(dir, p);
      const typeChange = afterFolders.has(p) || beforeFolders.has(p) || entryAbove(after, p) || entryAbove(before, p);
      const onDisk = !!st && (st.isSymbolicLink() || st.isDirectory());
      if (typeChange || onDisk || odd(before.get(p) ?? null) || odd(after.get(p) ?? null)) special.push(p);
      else plain.push(p);
    }

    // Check first.
    /** @type {Set<string>} untracked (ignored) things in the way, and folders that must become files */
    const clear = new Set();
    /** @type {string[]} */
    const blocked = [];
    const expendable = async (/** @type {string} */ p) =>
      !p.split('/').includes('.git') && (await git.isIgnored({ fs, dir, filepath: p }).catch(() => false));
    for (const p of special) {
      const a = after.get(p) ?? null;
      const st = lstatWork(dir, p);
      if (!a || a.mode === GITLINK || !st || !st.isDirectory()) continue;
      // A folder that becomes a file: its tracked files go with the switch; anything else must be ignored.
      for (const f of filesUnder(dir, p)) if (!before.has(f) && !(await expendable(f))) blocked.push(f);
      clear.add(p);
    }
    const folderOk = new Set();
    for (const p of paths) {
      if (!after.has(p)) continue;
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (folderOk.has(d)) continue;
        const st = lstatWork(dir, d);
        if (!st) break;
        if (st.isDirectory()) {
          folderOk.add(d);
          continue;
        }
        // A file or link where a folder has to be: fine when it's tracked and goes, or ignored.
        if (!(before.has(d) && !after.has(d))) {
          if (await expendable(d)) clear.add(d);
          else blocked.push(d);
        }
        break;
      }
    }
    if (blocked.length) {
      const by = what === 'pull' ? 'merge' : what;
      throw new GitError(
        `The following untracked working tree files would be removed by ${by}:\n${[...new Set(blocked)]
          .sort()
          .map((p) => `\t${p}`)
          .join('\n')}\nPlease move or remove them before you ${ADVICE[what]}.`,
      );
    }

    // Then act: what goes first, deepest first, so files can take the place of folders.
    for (const p of [...clear].sort().reverse()) {
      fs.rmSync(path.join(dir, p), { recursive: true, force: true });
      await git.remove({ fs, dir, filepath: p }).catch(() => undefined);
    }
    for (const p of special.filter((x) => !after.has(x)).sort().reverse()) await setFile(dir, p, null);
    // force: what would be lost was checked above and by assertCanSwitch.
    if (plain.length) await git.checkout({ fs, dir, ref: to, filepaths: plain, force: true, noUpdateHead: true });
    for (const p of special.filter((x) => after.has(x)).sort()) await setFile(dir, p, /** @type {Entry} */ (after.get(p)));
  }

  /**
   * Moves the working tree and index from commit `from` (null before the
   * first commit) to `to`, like the checkout real git does when it moves a
   * branch with no local changes in the way (a rebase, or a merge it made).
   * `extra` paths are reset to `to` too, like `git reset --hard` does with
   * local changes.
   * @param {string} dir @param {string | null} from @param {string} to
   * @param {{ what?: 'checkout' | 'merge' | 'pull' | 'rebase', extra?: string[] }} [opts]
   */
  async function moveTo(dir, from, to, { what = 'checkout', extra = [] } = {}) {
    const before = from ? await files(dir, from) : new Map();
    const after = await files(dir, to);
    const differ = [...new Set([...before.keys(), ...after.keys()])].filter((p) => !sameEntry(before.get(p) ?? null, after.get(p) ?? null));
    await switchFiles(dir, before, after, [...new Set([...differ, ...extra])].sort(), { to, what });
  }

  /**
   * Where `git checkout <ref>` leaves HEAD, worked out before anything
   * changes: on a local branch (one made from origin's branch of that name,
   * tracking it, when only that exists), or detached at the commit, as real
   * git does for a tag, an oid or HEAD~1.
   * @returns {Promise<{ keep: true } | { branch: string, track?: string } | { detach: true }>}
   */
  async function headFor(dir, /** @type {string} */ ref, /** @type {string} */ to) {
    if (ref === 'HEAD') return { keep: true };
    const name = ref.replace(/^refs\/heads\//, '');
    const branch = `refs/heads/${name}`;
    if (await git.resolveRef({ fs, dir, ref: branch }).catch(() => null)) return { branch };
    const resolves = await resolveCommit(dir, ref).then(
      () => true,
      () => false,
    );
    if (!resolves && (await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${name}` }).catch(() => null)) === to) return { branch, track: name };
    return { detach: true };
  }

  /**
   * `git checkout <ref>` that keeps local changes, as real git does: refuses
   * when the switch would overwrite any, and otherwise rewrites only the files
   * that differ between HEAD and the target, so staged and unstaged edits to
   * the rest come along. (isomorphic-git's own checkout resets every file
   * whose working copy matches the index, losing staged edits.) With `move`,
   * that branch is pointed at `to` (a pull or fast-forward). Refs change only
   * once the files have, so HEAD never names a commit the files don't match.
   * @param {string} dir
   * @param {{ ref: string, to: string, what?: 'checkout' | 'merge' | 'pull' | 'rebase', move?: string }} opts
   * @returns {Promise<{ detached: boolean }>}
   */
  async function checkoutSafely(dir, { ref, to, what = 'checkout', move }) {
    const from = await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
    const { differ, before, after } = await assertCanSwitch(dir, from, to, what);
    if (!from) {
      // Into an unborn branch real git refuses even ignored files in the way.
      const inTheWay = [...after].filter(([p, e]) => {
        const st = lstatWork(dir, p);
        return !!st && !(e.mode === GITLINK && st.isDirectory());
      });
      if (inTheWay.length) {
        const by = what === 'pull' ? 'merge' : what;
        throw new GitError(
          `The following untracked working tree files would be overwritten by ${by}:\n${inTheWay.map(([p]) => `\t${p}`).join('\n')}\nPlease move or remove them before you ${ADVICE[what]}.`,
        );
      }
    }
    const head = move ? null : await headFor(dir, ref, to);
    await switchFiles(dir, before, after, differ, { to, what });
    if (move) {
      await git.writeRef({ fs, dir, ref: move, value: to, force: true });
      return { detached: false };
    }
    if (!head || 'keep' in head) return { detached: false };
    if ('branch' in head) {
      if (head.track) {
        await git.writeRef({ fs, dir, ref: head.branch, value: to, force: true });
        await git.setConfig({ fs, dir, path: `branch.${head.track}.remote`, value: 'origin' });
        await git.setConfig({ fs, dir, path: `branch.${head.track}.merge`, value: head.branch });
      }
      await git.writeRef({ fs, dir, ref: 'HEAD', value: head.branch, symbolic: true, force: true });
      return { detached: false };
    }
    await git.writeRef({ fs, dir, ref: 'HEAD', value: to, force: true });
    return { detached: true };
  }

  /** The tree a commit points to. */
  async function treeOf(dir, oid) {
    return (await git.readCommit({ fs, dir, oid })).commit.tree;
  }

  /**
   * A commit from what a user types: a branch, tag, remote branch, HEAD or
   * (part of) an oid, optionally followed by ~n and ^n.
   * @param {string} spec
   */
  async function resolveCommit(dir, spec) {
    const [, name, steps] = /^(.*?)((?:[~^]\d*)*)$/.exec(spec) ?? [spec, spec, ''];
    let oid = await git.resolveRef({ fs, dir, ref: name }).catch(() => null);
    if (!oid && /^[0-9a-f]{4,40}$/i.test(name)) oid = await git.expandOid({ fs, dir, oid: name.toLowerCase() }).catch(() => null);
    if (!oid) throw new GitError(`unknown revision ${spec}`);
    // An annotated tag points at a tag object; follow it to the commit.
    for (let { type, object } = await git.readObject({ fs, dir, oid }); type !== 'commit'; { type, object } = await git.readObject({ fs, dir, oid })) {
      if (type !== 'tag') throw new GitError(`${spec} is not a commit`);
      oid = object.object;
    }
    for (const [, op, n] of steps.matchAll(/([~^])(\d*)/g)) {
      const count = n === '' ? 1 : Number(n);
      for (let i = 0; i < (op === '~' ? count : Math.min(count, 1)); i++) {
        const { commit } = await git.readCommit({ fs, dir, oid });
        oid = op === '~' ? commit.parent[0] : commit.parent[count - 1];
        if (!oid) throw new GitError(`unknown revision ${spec}`);
      }
    }
    return /** @type {string} */ (oid);
  }

  return {
    blob,
    files,
    indexFiles,
    writeTree,
    writeFile,
    removeFile,
    setFile,
    applyChange,
    restore,
    treeOf,
    resolveCommit,
    isBinary,
    switchBlockers,
    assertCanSwitch,
    checkoutSafely,
    moveTo,
    switchFiles,
  };
}

module.exports = { createTree, lstatWork, readWork, sameEntry, GITLINK, SYMLINK };
