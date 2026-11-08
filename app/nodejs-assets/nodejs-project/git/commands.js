// @ts-check
// The porcelain `git stash`, `git tag`, `git cherry-pick` and `git rebase` for
// the local shell. The work is in stash.js and sequencer.js, which the Git
// Tools screens use too (ui.js); this prints what real git would.
'use strict';

const fs = require('fs');

const { lineStat } = require('./diffstat');

/**
 * @param {{ git: any, http: any, author(): { name: string, email: string }, onAuth: any, onAuthFailure: any, GitError: any,
 *   findRoot(): Promise<string>, takeFlag(args: string[], ...names: string[]): boolean, takeValue(args: string[], ...names: string[]): string | undefined,
 *   stash: ReturnType<typeof import('./stash').createStash>, sequencer: ReturnType<typeof import('./sequencer').createSequencer>,
 *   tree: ReturnType<typeof import('./tree').createTree> }} deps
 */
function createCommands({ git, http, author, onAuth, onAuthFailure, GitError, findRoot, takeFlag, takeValue, stash, sequencer, tree }) {
  const short = (/** @type {string} */ oid) => oid.slice(0, 7);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function printConflicts(files) {
    for (const f of files) console.log(`CONFLICT: merge conflict in ${f}`);
  }

  // Lines like `git diff --stat` for a list of { path, before, after } blob
  // ids. A submodule (gitlink, `beforeGitlink` / `afterGitlink`) counts as
  // the line real git diffs for it: "Subproject commit <oid>".
  async function printStat(dir, files) {
    let added = 0;
    let removed = 0;
    for (const f of files) {
      const text = async (oid, gitlink) => (!oid ? '' : gitlink ? `Subproject commit ${oid}\n` : (await tree.blob(dir, oid)).toString('utf8'));
      const stat = lineStat(await text(f.before, f.beforeGitlink), await text(f.after, f.afterGitlink));
      if (!stat) {
        console.log(` ${f.path} | (too large to count)`);
        continue;
      }
      added += stat.added;
      removed += stat.removed;
      console.log(` ${f.path} | ${stat.added + stat.removed} \x1b[32m${'+'.repeat(Math.min(stat.added, 30))}\x1b[31m${'-'.repeat(Math.min(stat.removed, 30))}\x1b[0m`);
    }
    if (files.length) console.log(` ${plural(files.length, 'file')} changed, ${added} insertions(+), ${removed} deletions(-)`);
  }

  /** Pushes every tag the remote doesn't already have. */
  async function pushTags(dir, remote) {
    const url = (await git.listRemotes({ fs, dir })).find((r) => r.remote === remote)?.url;
    if (!url) throw new GitError(`no remote named ${remote}`);
    const theirs = new Map(
      (await git.listServerRefs({ http, url, prefix: 'refs/tags/', onAuth, onAuthFailure })).map((r) => [r.ref, r.oid]),
    );
    let failed = false;
    let pushed = 0;
    for (const name of await git.listTags({ fs, dir })) {
      const oid = await git.resolveRef({ fs, dir, ref: `refs/tags/${name}` });
      if (theirs.get(`refs/tags/${name}`) === oid) continue;
      const r = await git.push({ fs, http, dir, remote, ref: `refs/tags/${name}`, onAuth, onAuthFailure });
      const ok = r.ok && Object.values(r.refs).every((x) => /** @type {any} */ (x).ok);
      console.log(ok ? `${name}: pushed to ${remote}` : `${name}: rejected (${r.error || 'remote refused it'})`);
      if (ok) pushed++;
      else failed = true;
    }
    if (!pushed && !failed) console.log('Everything up-to-date');
    return failed ? 1 : 0;
  }

  /** @param {import('./sequencer').Result} r */
  function stopped(r, what) {
    if (r.status !== 'conflict') return;
    console.log(`error: could not apply ${short(r.current.oid)}... ${r.current.subject}`);
    printConflicts(r.conflicts);
    console.log(`hint: fix the conflicts, mark them resolved with git add <file>, then run git ${what} --continue`);
    console.log(`hint: or git ${what} --abort to go back${what === 'rebase' ? ', or git rebase --skip to leave this commit out' : ''}`);
  }

  return {
    async stash(args) {
      const dir = await findRoot();
      const sub = args[0] && !args[0].startsWith('-') ? args.shift() : 'push';
      switch (sub) {
        case 'push':
        case 'save': {
          const untracked = takeFlag(args, '-u', '--include-untracked');
          const message = takeValue(args, '-m', '--message') ?? (sub === 'save' ? args.join(' ') : '');
          const r = await stash.push(dir, { message, untracked });
          console.log(r ? `Saved working directory and index state ${r.message}` : 'No local changes to save');
          return 0;
        }
        case 'list':
          for (const s of stash.list(dir)) console.log(`stash@{${s.index}}: ${s.message}`);
          return 0;
        case 'show':
          await printStat(dir, await stash.show(dir, stash.index(args[0])));
          return 0;
        case 'apply':
        case 'pop': {
          const n = stash.index(args.find((a) => !a.startsWith('-')));
          const oid = stash.list(dir)[n]?.oid;
          const r = sub === 'pop' ? await stash.pop(dir, n) : await stash.apply(dir, n);
          if (r.conflicts.length) {
            printConflicts(r.conflicts);
            if (sub === 'pop') console.log('The stash entry is kept in case you need it again.');
            return 1;
          }
          if (sub === 'pop' && oid) console.log(`Dropped stash@{${n}} (${oid})`);
          return 0;
        }
        case 'drop': {
          const n = stash.index(args[0]);
          const e = await stash.drop(dir, n);
          console.log(`Dropped stash@{${n}} (${e.oid})`);
          return 0;
        }
        case 'clear':
          await stash.clear(dir);
          return 0;
        default:
          throw new GitError(`unknown stash command ${sub} (use push, list, show, apply, pop, drop or clear)`);
      }
    },

    async tag(args) {
      const dir = await findRoot();
      if (takeFlag(args, '-d', '--delete')) {
        const names = args.filter((a) => !a.startsWith('-'));
        if (!names.length) throw new GitError('usage: git tag -d <name>...');
        for (const name of names) {
          const oid = await git.resolveRef({ fs, dir, ref: `refs/tags/${name}` }).catch(() => null);
          if (!oid) throw new GitError(`tag '${name}' not found`);
          await git.deleteTag({ fs, dir, ref: name });
          console.log(`Deleted tag '${name}' (was ${short(oid)})`);
        }
        return 0;
      }
      const listing = takeFlag(args, '-l', '--list');
      const annotated = takeFlag(args, '-a', '--annotate');
      const force = takeFlag(args, '-f', '--force');
      const message = takeValue(args, '-m', '--message');
      const [name, target = 'HEAD'] = args.filter((a) => !a.startsWith('-'));
      if (listing || !name) {
        // A pattern after -l, like real git's `git tag -l 'v1.*'`.
        const pattern = listing && name ? new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`) : null;
        const tags = (await git.listTags({ fs, dir })).filter((t) => !pattern || pattern.test(t)).sort();
        for (const t of tags) console.log(t);
        return 0;
      }
      if (annotated && message === undefined) throw new GitError('an annotated tag needs a message: git tag -a <name> -m <message>');
      const object = await tree.resolveCommit(dir, target);
      try {
        // -m alone makes an annotated tag, as in real git.
        if (annotated || message !== undefined) {
          const me = author();
          await git.annotatedTag({ fs, dir, ref: name, object, message: `${message ?? ''}\n`, tagger: { name: me.name, email: me.email }, force });
        } else await git.tag({ fs, dir, ref: name, object, force });
      } catch (e) {
        if (e && /** @type {any} */ (e).code === 'AlreadyExistsError') throw new GitError(`tag '${name}' already exists (use -f to move it)`);
        if (e && /** @type {any} */ (e).code === 'InvalidRefNameError') throw new GitError(`'${name}' is not a valid tag name`);
        throw e;
      }
      return 0;
    },

    async 'cherry-pick'(args) {
      const dir = await findRoot();
      if (takeFlag(args, '--continue')) {
        const r = await sequencer.cherryPickContinue(dir);
        if (r.status === 'done' && r.commit) console.log(`[${(await git.currentBranch({ fs, dir })) ?? 'HEAD'} ${short(r.commit)}] cherry-picked`);
        if (r.status === 'empty') console.log('Nothing was staged, so the cherry-pick made no commit.');
        return 0;
      }
      if (takeFlag(args, '--quit')) {
        // Forgets the cherry-pick, keeping the working tree and index as they are.
        sequencer.cherryPickQuit(dir);
        return 0;
      }
      if (takeFlag(args, '--abort', '--skip')) {
        await sequencer.cherryPickAbort(dir);
        return 0;
      }
      const specs = args.filter((a) => !a.startsWith('-'));
      if (specs.length !== 1) throw new GitError('usage: git cherry-pick <commit> | --continue | --abort (one commit at a time)');
      const r = await sequencer.cherryPick(dir, specs[0]);
      if (r.status === 'conflict') {
        stopped(r, 'cherry-pick');
        return 1;
      }
      if (r.status === 'empty') {
        console.log(`${short(r.current.oid)} changes nothing here: HEAD already has it.`);
        return 1;
      }
      if (r.status === 'done' && r.commit) {
        const { commit } = await git.readCommit({ fs, dir, oid: r.commit });
        console.log(`[${(await git.currentBranch({ fs, dir })) ?? 'HEAD'} ${short(r.commit)}] ${commit.message.split('\n')[0]}`);
      }
      return 0;
    },

    async rebase(args) {
      const dir = await findRoot();
      let r;
      if (takeFlag(args, '--abort')) {
        await sequencer.rebaseAbort(dir);
        return 0;
      }
      if (takeFlag(args, '--continue')) r = await sequencer.rebaseContinue(dir);
      else if (takeFlag(args, '--skip')) r = await sequencer.rebaseSkip(dir);
      else {
        if (args.some((a) => ['-i', '--interactive', '--onto', '--root', '-r', '--rebase-merges'].includes(a))) {
          throw new GitError('only `git rebase <upstream>` is available locally; interactive rebase, --onto and --root need Remote mode');
        }
        let upstream = args.find((a) => !a.startsWith('-'));
        const branch = await git.currentBranch({ fs, dir });
        if (!upstream && branch) {
          // The branch's upstream, like real git.
          const remote = await git.getConfig({ fs, dir, path: `branch.${branch}.remote` });
          const merge = await git.getConfig({ fs, dir, path: `branch.${branch}.merge` });
          if (remote && merge) upstream = `${remote}/${String(merge).replace(/^refs\/heads\//, '')}`;
        }
        if (!upstream) throw new GitError('usage: git rebase <upstream> | --continue | --skip | --abort');
        r = await sequencer.rebase(dir, upstream);
        const name = branch ?? 'HEAD';
        if (r.status === 'up-to-date') {
          console.log(`Current branch ${name} is up to date.`);
          return 0;
        }
        if (r.status === 'fast-forward') {
          console.log(`Fast-forwarded ${name} to ${upstream}.`);
          return 0;
        }
      }
      if (r.status === 'conflict') {
        stopped(r, 'rebase');
        return 1;
      }
      if (r.status === 'done') {
        for (const s of r.skipped) console.log(`dropped ${short(s.oid)} ${s.subject} (its changes are already upstream)`);
        console.log(`Successfully rebased and updated refs/heads/${(await git.currentBranch({ fs, dir })) ?? 'HEAD'}.`);
      }
      return 0;
    },

    pushTags,

    /** Lines for `git status` while a rebase or cherry-pick waits. */
    async progressLines(dir) {
      const p = await sequencer.progress(dir);
      if (!p) return [];
      if (p.kind === 'cherry-pick') {
        return [`You are cherry-picking ${short(p.current.oid)} (${p.current.subject}).`, '  (fix conflicts and run "git cherry-pick --continue", or "git cherry-pick --abort")'];
      }
      return [
        `You are rebasing ${p.branch} onto ${short(p.onto)} (${p.step}/${p.total} applied).`,
        ...(p.current ? [`  stopped at ${short(p.current.oid)} (${p.current.subject})`] : []),
        '  (fix conflicts and run "git rebase --continue", or "git rebase --skip" / "git rebase --abort")',
      ];
    },
  };
}

module.exports = { createCommands };
