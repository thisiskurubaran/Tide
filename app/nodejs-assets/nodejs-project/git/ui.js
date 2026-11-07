// @ts-check
// `git __tide <command>`: JSON answers for Git Pro's screens, which need file
// contents and exact index writes that the porcelain commands don't print.
// Each command prints one JSON value on stdout.
'use strict';

const fs = require('fs');
const { blame } = require('./blame');
const path = require('path');
const { CONFLICTS, conflicts, gitFile, readGitFile, setConflicts } = require('./state');
const { lstatWork, readWork, sameEntry } = require('./tree');

// Merge state isomorphic-git doesn't keep: the commit being merged (as real
// git does) and which files had conflicts, until they are staged (state.js).
const MERGE_HEAD = 'MERGE_HEAD';
const MERGE_MSG = 'MERGE_MSG';

/** @param {Buffer | Uint8Array} buf */
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

/**
 * @param {{ git: any, http: any, findRoot(): Promise<string>, changes(dir: string, paths?: string[]): Promise<any[]>,
 *   author(): { name: string, email: string }, onAuth: any, onAuthFailure: any, GitError: any,
 *   tree: ReturnType<typeof import('./tree').createTree>, stash: ReturnType<typeof import('./stash').createStash>,
 *   sequencer: ReturnType<typeof import('./sequencer').createSequencer> }} deps
 */
function createUi({ git, http, findRoot, changes, author, onAuth, onAuthFailure, GitError, tree, stash, sequencer }) {
  const clearMerge = (dir) => {
    for (const name of [MERGE_HEAD, MERGE_MSG, CONFLICTS]) fs.rmSync(gitFile(dir, name), { force: true });
  };

  /** Blob text at HEAD or in a commit, or null when the file isn't there. */
  async function blobAt(dir, oid, filepath) {
    try {
      const { blob } = await git.readBlob({ fs, dir, oid, filepath });
      return Buffer.from(blob);
    } catch {
      return null;
    }
  }

  async function indexEntry(dir, filepath) {
    let found = null;
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE()],
      map: async (/** @type {string} */ p, /** @type {any[]} */ [entry]) => {
        if (p === filepath && entry) found = { oid: await entry.oid(), mode: await entry.mode() };
        return p === '.' || filepath.startsWith(`${p}/`) || p === filepath ? true : null;
      },
    });
    return /** @type {{ oid: string, mode: number } | null} */ (found);
  }

  async function headOid(dir) {
    try {
      return await git.resolveRef({ fs, dir, ref: 'HEAD' });
    } catch {
      return null;
    }
  }

  /** @param {(Buffer | null)[]} sides */
  const texts = (sides) => {
    if (sides.some((b) => b && isBinary(b))) return { binary: true };
    return { binary: false, sides: sides.map((b) => (b ? b.toString('utf8') : null)) };
  };

  // Stage or unstage the whole file, like `git add` / `git restore --staged`.
  async function stagePath(dir, filepath) {
    if (lstatWork(dir, filepath)) await git.add({ fs, dir, filepath });
    else await git.remove({ fs, dir, filepath });
    setConflicts(dir, conflicts(dir).filter((p) => p !== filepath));
  }

  /**
   * After a merge with conflicts, makes the index hold the merge result for
   * every path that isn't conflicted, as real git does, so only conflicted
   * paths are left to resolve. isomorphic-git (abortOnConflict: false) stages
   * only paths both sides changed: a file changed or added only on their side
   * was left unstaged or untracked, and one deleted only on their side wasn't
   * deleted, so committing the merge dropped those changes.
   * @param {string} dir @param {string} oursOid @param {string} theirsOid @param {string[]} unmerged
   */
  async function stageMergeResult(dir, oursOid, theirsOid, unmerged) {
    const [base] = await git.findMergeBase({ fs, dir, oids: [oursOid, theirsOid] });
    const [b, o, t] = await Promise.all([base ? tree.files(dir, base) : new Map(), tree.files(dir, oursOid), tree.files(dir, theirsOid)]);
    const skip = new Set(unmerged);
    for (const filepath of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
      if (skip.has(filepath)) continue;
      const [be, oe, te] = [b.get(filepath) ?? null, o.get(filepath) ?? null, t.get(filepath) ?? null];
      // Ours already is the result.
      if (sameEntry(oe, te) || sameEntry(be, te)) continue;
      // Only their side changed it: take theirs, in the working tree and index.
      if (sameEntry(be, oe)) {
        await tree.setFile(dir, filepath, te);
        continue;
      }
      // Both changed it and it merged cleanly: stage what the merge wrote.
      if (lstatWork(dir, filepath)) await git.add({ fs, dir, filepath });
      else await git.remove({ fs, dir, filepath });
    }
  }

  /** @type {Record<string, (dir: string, args: string[]) => Promise<unknown>>} */
  const commands = {
    async status(dir) {
      const list = await changes(dir);
      const unmerged = new Set(conflicts(dir));
      return {
        branch: await git.currentBranch({ fs, dir }),
        merging: readGitFile(dir, MERGE_HEAD) ? readGitFile(dir, MERGE_MSG) || 'a merge' : null,
        operation: await sequencer.progress(dir),
        changes: list.map((c) => ({ path: c.path, code: unmerged.has(c.path) ? 'UU' : c.code })),
      };
    },

    // The file at HEAD, in the index and in the working tree.
    async show(dir, [filepath]) {
      const head = await headOid(dir);
      const entry = await indexEntry(dir, filepath);
      const work = readWork(dir, filepath);
      const index = entry ? Buffer.from((await git.readBlob({ fs, dir, oid: entry.oid })).blob) : null;
      const r = texts([head ? await blobAt(dir, head, filepath) : null, index, work]);
      return r.binary ? { binary: true } : { binary: false, head: r.sides[0], index: r.sides[1], work: r.sides[2] };
    },

    async stage(dir, paths) {
      for (const p of paths) await stagePath(dir, p);
      return null;
    },

    // Writes exact text into the index for one file: staging part of a change.
    async 'stage-text'(dir, [filepath, base64]) {
      const blob = Buffer.from(base64, 'base64');
      const oid = await git.writeBlob({ fs, dir, blob });
      const entry = await indexEntry(dir, filepath);
      await git.updateIndex({ fs, dir, filepath, oid, mode: entry ? entry.mode : 0o100644, add: true, force: true });
      return null;
    },

    async unstage(dir, paths) {
      for (const filepath of paths) await git.resetIndex({ fs, dir, filepath });
      return null;
    },

    // Throws away working tree changes: back to the index, or deleted if untracked.
    async discard(dir, paths) {
      for (const filepath of paths) {
        const entry = await indexEntry(dir, filepath);
        const abs = path.join(dir, filepath);
        if (!entry) {
          fs.rmSync(abs, { force: true });
          continue;
        }
        const { blob } = await git.readBlob({ fs, dir, oid: entry.oid });
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from(blob));
      }
      return null;
    },

    // Commits what is staged. During a merge the merged commit is the second parent.
    async commit(dir, [base64]) {
      const message = Buffer.from(base64, 'base64').toString('utf8');
      const unresolved = conflicts(dir);
      if (unresolved.length) throw new GitError(`resolve and stage ${unresolved.join(', ')} first`);
      const staged = (await changes(dir)).filter((c) => c.code[0] !== ' ' && c.code !== '??');
      const merging = readGitFile(dir, MERGE_HEAD);
      if (!staged.length && !merging) throw new GitError('nothing staged to commit');
      const head = await headOid(dir);
      const parent = merging && head ? [head, merging] : undefined;
      const oid = await git.commit({ fs, dir, message, author: author(), parent });
      clearMerge(dir);
      sequencer.committed(dir);
      return { oid, files: staged.length };
    },

    async branches(dir) {
      const remotes = await git.listRemotes({ fs, dir }).catch(() => []);
      const remote = [];
      for (const r of remotes) {
        for (const b of await git.listBranches({ fs, dir, remote: r.remote }).catch(() => [])) {
          if (b !== 'HEAD') remote.push(`${r.remote}/${b}`);
        }
      }
      return { current: await git.currentBranch({ fs, dir }), local: await git.listBranches({ fs, dir }), remote };
    },

    async 'create-branch'(dir, [name]) {
      await git.branch({ fs, dir, ref: name, checkout: true });
      return null;
    },

    async checkout(dir, [ref]) {
      const local = await git.listBranches({ fs, dir });
      // origin/feature becomes a local feature branch tracking it.
      if (!local.includes(ref) && ref.includes('/')) {
        const [remote, ...rest] = ref.split('/');
        const name = rest.join('/');
        const to = await tree.resolveCommit(dir, local.includes(name) ? name : `refs/remotes/${remote}/${name}`);
        // Checked before the branch is made, so a refused switch leaves nothing behind.
        await tree.assertCanSwitch(dir, await headOid(dir), to);
        if (!local.includes(name)) await git.branch({ fs, dir, ref: name, object: to });
        await tree.checkoutSafely(dir, { ref: name, to });
        return null;
      }
      // Refuses, like real git, when the switch would overwrite local changes.
      await tree.checkoutSafely(dir, { ref, to: await tree.resolveCommit(dir, ref) });
      return null;
    },

    async 'delete-branch'(dir, [name]) {
      if (name === (await git.currentBranch({ fs, dir }))) throw new GitError(`${name} is checked out; switch branches first`);
      await git.deleteBranch({ fs, dir, ref: name });
      return null;
    },

    // Merges a branch into the current one. Conflicts are written into the
    // files with markers, like real git, and the merge waits for a commit.
    async merge(dir, [theirs]) {
      const ours = await git.currentBranch({ fs, dir });
      if (!ours) throw new GitError('check out a branch before merging');
      if ((await changes(dir)).some((c) => c.code !== '??')) throw new GitError('commit or discard your changes before merging');
      const theirsOid = await git.resolveRef({ fs, dir, ref: theirs });
      // The forced checkout below would overwrite untracked files at paths the
      // merged branch tracks; refuse first, as real git does.
      await tree.assertCanSwitch(dir, await headOid(dir), await tree.resolveCommit(dir, theirsOid), 'merge');
      const message = `Merge branch '${theirs}' into ${ours}`;
      const oursOid = await git.resolveRef({ fs, dir, ref: ours });
      try {
        const result = await git.merge({ fs, dir, ours, theirs, author: author(), message, abortOnConflict: false });
        // merge moves the branch; the working tree has to follow it.
        await git.checkout({ fs, dir, ref: ours, force: true });
        return { conflicts: [], fastForward: !!result.fastForward, alreadyMerged: !!result.alreadyMerged };
      } catch (e) {
        const err = /** @type {any} */ (e);
        if (err && err.code === 'MergeConflictError') {
          const files = err.data && err.data.filepaths ? err.data.filepaths : [];
          await stageMergeResult(dir, oursOid, theirsOid, files);
          fs.writeFileSync(gitFile(dir, MERGE_HEAD), `${theirsOid}\n`);
          fs.writeFileSync(gitFile(dir, MERGE_MSG), `${message}\n`);
          setConflicts(dir, files);
          return { conflicts: files, fastForward: false, alreadyMerged: false };
        }
        throw e;
      }
    },

    async 'abort-merge'(dir) {
      // Like `git merge --abort`: every path the merge staged or left
      // conflicted goes back to HEAD, so files it added are removed again.
      const head = await headOid(dir);
      if (head) {
        const [inHead, inIndex] = await Promise.all([tree.files(dir, head), tree.indexFiles(dir)]);
        const staged = [...new Set([...inHead.keys(), ...inIndex.keys()])].filter((p) => !sameEntry(inHead.get(p) ?? null, inIndex.get(p) ?? null));
        await tree.restore(dir, head, [...new Set([...staged, ...conflicts(dir)])]);
      }
      await git.abortMerge({ fs, dir });
      clearMerge(dir);
      return null;
    },

    async log(dir, [n]) {
      let entries;
      try {
        entries = await git.log({ fs, dir, depth: Number(n) || 50 });
      } catch {
        return [];
      }
      return entries.map((/** @type {any} */ { oid, commit }) => ({
        oid,
        message: commit.message.trimEnd(),
        author: commit.author.name,
        timestamp: commit.author.timestamp,
        parents: commit.parent,
      }));
    },

    // Files a commit changed, compared with its first parent.
    async 'commit-files'(dir, [oid]) {
      const { commit } = await git.readCommit({ fs, dir, oid });
      const parent = commit.parent[0];
      const trees = parent ? [git.TREE({ ref: oid }), git.TREE({ ref: parent })] : [git.TREE({ ref: oid })];
      const files = [];
      await git.walk({
        fs,
        dir,
        trees,
        map: async (/** @type {string} */ filepath, /** @type {any[]} */ [now, before]) => {
          if (filepath === '.') return true;
          const type = (await now?.type()) ?? (await before?.type());
          if (type === 'tree') return true;
          const a = now ? await now.oid() : null;
          const b = before ? await before.oid() : null;
          if (a !== b) files.push({ path: filepath, status: !b ? 'added' : !a ? 'deleted' : 'modified' });
          return true;
        },
      });
      // walk visits entries concurrently, so the order isn't stable.
      return files.sort((a, b) => (a.path < b.path ? -1 : 1));
    },

    async 'commit-file'(dir, [oid, filepath]) {
      const { commit } = await git.readCommit({ fs, dir, oid });
      const parent = commit.parent[0];
      const r = texts([parent ? await blobAt(dir, parent, filepath) : null, await blobAt(dir, oid, filepath)]);
      return r.binary ? { binary: true } : { binary: false, before: r.sides[0], after: r.sides[1] };
    },

    // Commits that changed a file, newest first.
    async 'file-log'(dir, [filepath, n]) {
      let entries;
      try {
        entries = await git.log({ fs, dir, filepath, depth: Number(n) || 100 });
      } catch {
        return [];
      }
      return entries.map((/** @type {any} */ { oid, commit }) => ({
        oid,
        message: commit.message.trimEnd(),
        author: commit.author.name,
        timestamp: commit.author.timestamp,
        parents: commit.parent,
      }));
    },

    // Who last changed each line of the working copy: runs of lines with their
    // commit, oid null for changes not committed yet. Lines older than the
    // last `n` commits that touched the file are given to the oldest one.
    async blame(dir, [filepath, n]) {
      const work = readWork(dir, filepath);
      if (!work) throw new GitError(`${filepath} isn't in the working tree`);
      if (isBinary(work)) return { binary: true };
      let entries = [];
      try {
        entries = await git.log({ fs, dir, filepath, depth: Number(n) || 200 });
      } catch {
        // No commits yet: everything is uncommitted.
      }
      /** @type {{ oid: string | null, text: string }[]} */
      const versions = [{ oid: null, text: work.toString('utf8') }];
      for (const e of entries) {
        const blob = await blobAt(dir, e.oid, filepath);
        if (blob && !isBinary(blob)) versions.push({ oid: e.oid, text: blob.toString('utf8') });
      }
      const commits = Object.fromEntries(
        entries.map((/** @type {any} */ { oid, commit }) => [oid, { oid, message: commit.message.trimEnd(), author: commit.author.name, timestamp: commit.author.timestamp }]),
      );
      return { binary: false, runs: blame(versions), commits, truncated: entries.length >= (Number(n) || 200) };
    },

    // Stashes, newest first, with when each was made.
    async stashes(dir) {
      const out = [];
      for (const s of stash.list(dir)) {
        const { commit } = await git.readCommit({ fs, dir, oid: s.oid });
        out.push({ ...s, timestamp: commit.author.timestamp, parents: commit.parent });
      }
      return out;
    },

    async 'stash-push'(dir, [base64, untracked]) {
      return stash.push(dir, { message: Buffer.from(base64 ?? '', 'base64').toString('utf8'), untracked: untracked === '1' });
    },

    async 'stash-apply'(dir, [n]) {
      return stash.apply(dir, Number(n) || 0);
    },

    async 'stash-pop'(dir, [n]) {
      return stash.pop(dir, Number(n) || 0);
    },

    async 'stash-drop'(dir, [n]) {
      await stash.drop(dir, Number(n) || 0);
      return null;
    },

    // Tags with the commit each points at; annotated ones with their message.
    async tags(dir) {
      const out = [];
      for (const name of await git.listTags({ fs, dir })) {
        const oid = await git.resolveRef({ fs, dir, ref: `refs/tags/${name}` });
        const { type, object } = await git.readObject({ fs, dir, oid });
        out.push(
          type === 'tag'
            ? { name, oid: await tree.resolveCommit(dir, oid), annotated: true, message: String(object.message).trimEnd() }
            : { name, oid, annotated: false, message: null },
        );
      }
      return out.sort((a, b) => (a.name < b.name ? -1 : 1));
    },

    // An empty message makes a lightweight tag.
    async 'create-tag'(dir, [name, base64, target]) {
      const message = Buffer.from(base64 ?? '', 'base64').toString('utf8').trim();
      const object = await tree.resolveCommit(dir, target || 'HEAD');
      try {
        if (message) {
          const me = author();
          await git.annotatedTag({ fs, dir, ref: name, object, message: `${message}\n`, tagger: { name: me.name, email: me.email } });
        } else await git.tag({ fs, dir, ref: name, object });
      } catch (e) {
        const code = e && /** @type {any} */ (e).code;
        if (code === 'AlreadyExistsError') throw new GitError(`tag ${name} already exists`);
        if (code === 'InvalidRefNameError') throw new GitError(`${name} is not a valid tag name`);
        throw e;
      }
      return null;
    },

    async 'delete-tag'(dir, [name]) {
      await git.deleteTag({ fs, dir, ref: name });
      return null;
    },

    async 'push-tag'(dir, [name]) {
      const result = await git.push({ fs, http, dir, remote: 'origin', ref: `refs/tags/${name}`, onAuth, onAuthFailure });
      if (!result.ok) throw new GitError(result.error || 'push failed');
      return null;
    },

    'cherry-pick': (dir, [oid]) => sequencer.cherryPick(dir, oid),
    'cherry-pick-continue': (dir) => sequencer.cherryPickContinue(dir),
    async 'cherry-pick-abort'(dir) {
      await sequencer.cherryPickAbort(dir);
      return null;
    },
    rebase: (dir, [upstream]) => sequencer.rebase(dir, upstream),
    'rebase-continue': (dir) => sequencer.rebaseContinue(dir),
    'rebase-skip': (dir) => sequencer.rebaseSkip(dir),
    async 'rebase-abort'(dir) {
      await sequencer.rebaseAbort(dir);
      return null;
    },

    async push(dir) {
      const ref = await git.currentBranch({ fs, dir });
      const result = await git.push({ fs, http, dir, remote: 'origin', ref, onAuth, onAuthFailure });
      if (!result.ok) throw new GitError(result.error || 'push failed');
      return null;
    },
  };

  return async function run(/** @type {string[]} */ args) {
    const [command, ...rest] = args;
    const fn = Object.prototype.hasOwnProperty.call(commands, command) ? commands[command] : null;
    if (!fn) throw new GitError(`unknown __tide command ${command}`);
    const dir = await findRoot();
    process.stdout.write(`${JSON.stringify(await fn(dir, rest))}\n`);
    return 0;
  };
}

module.exports = { createUi };
