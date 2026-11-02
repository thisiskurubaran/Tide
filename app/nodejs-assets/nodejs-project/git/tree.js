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

/** @param {Buffer | Uint8Array} buf */
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

const sameEntry = (/** @type {Entry | null} */ a, /** @type {Entry | null} */ b) => (!a || !b ? a === b : a.oid === b.oid && a.mode === b.mode);

/** @param {{ git: any, changes(dir: string, paths?: string[]): Promise<any[]>, GitError: any }} deps */
function createTree({ git, changes, GitError }) {
  async function blob(dir, oid) {
    return Buffer.from((await git.readBlob({ fs, dir, oid })).blob);
  }

  /** Every file in a commit's tree. @returns {Promise<Map<string, Entry>>} */
  async function files(dir, commit) {
    const out = new Map();
    await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref: commit })],
      map: async (/** @type {string} */ filepath, /** @type {any[]} */ [e]) => {
        if (filepath === '.' || !e) return true;
        if ((await e.type()) === 'blob') out.set(filepath, { oid: await e.oid(), mode: await e.mode() });
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

  /** The index as a flat list of files. @returns {Promise<Map<string, Entry>>} */
  async function indexFiles(dir) {
    const out = new Map();
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE()],
      map: async (/** @type {string} */ filepath, /** @type {any[]} */ [e]) => {
        if (filepath === '.' || !e) return true;
        if ((await e.type()) === 'blob') out.set(filepath, { oid: await e.oid(), mode: await e.mode() });
        return true;
      },
    });
    return out;
  }

  // Deleting a file shouldn't leave its empty folders behind, as in real git.
  function removeFile(dir, filepath) {
    fs.rmSync(path.join(dir, filepath), { force: true });
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

  /** Puts content into the working tree, as a file of the given mode. */
  function writeFile(dir, filepath, content, mode) {
    const abs = path.join(dir, filepath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.rmSync(abs, { force: true });
    if (mode === 0o120000) {
      fs.symlinkSync(content.toString('utf8'), abs);
      return;
    }
    fs.writeFileSync(abs, content);
    if (mode === 0o100755) fs.chmodSync(abs, 0o755);
  }

  /** Makes a file in the working tree and index match an entry, or removes it. */
  async function setFile(dir, filepath, /** @type {Entry | null} */ entry) {
    if (!entry) {
      removeFile(dir, filepath);
      await git.remove({ fs, dir, filepath }).catch(() => undefined);
      return;
    }
    writeFile(dir, filepath, await blob(dir, entry.oid), entry.mode);
    await git.add({ fs, dir, filepath });
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
    const info = async (/** @type {any} */ e) => (e && (await e.type()) === 'blob' ? { oid: await e.oid(), mode: await e.mode() } : null);
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
      if (t) writeFile(dir, filepath, await blob(dir, t.oid), t.mode);
      changed.push(filepath);
      conflicted.push(filepath);
    }
    if (conflicted.length) setConflicts(dir, [...new Set([...conflicts(dir), ...conflicted])]);
    return { changed, conflicts: conflicted };
  }

  /** Puts the given files back to how they are in a commit, in the working tree and index. */
  async function restore(dir, commit, /** @type {string[]} */ paths) {
    const all = await files(dir, commit);
    for (const filepath of paths) await setFile(dir, filepath, all.get(filepath) ?? null);
    setConflicts(dir, conflicts(dir).filter((p) => !paths.includes(p)));
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

  return { blob, files, indexFiles, writeTree, writeFile, removeFile, setFile, applyChange, restore, treeOf, resolveCommit, isBinary };
}

module.exports = { createTree };
