// Git Tools talks to the built-in git through `git __tide <command>`, which
// prints JSON (nodejs-project/git/ui.js).
import type { GitResult } from '../../features/git/runGit';
import { lastLines } from '../../features/git/runGit';

export interface FileChange {
  path: string;
  // Porcelain code, e.g. "M ", " M", "??", or "UU" for an unresolved conflict.
  code: string;
}

export interface Status {
  branch: string | null;
  // The merge message while a merge waits for its commit.
  merging: string | null;
  // A rebase or cherry-pick that stopped on a conflict, or is between steps.
  operation: Operation | null;
  changes: FileChange[];
}

export type FileVersions = { binary: true } | { binary: false; head: string | null; index: string | null; work: string | null };
export type CommitFileVersions = { binary: true } | { binary: false; before: string | null; after: string | null };

export interface Branches {
  current: string | null;
  local: string[];
  remote: string[];
}

export interface CommitInfo {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
}

// Runs of lines by the commit that last changed them; oid null is uncommitted.
export type Blame =
  | { binary: true }
  | {
      binary: false;
      runs: { oid: string | null; start: number; count: number }[];
      commits: Record<string, Omit<CommitInfo, 'parents'>>;
      // Older lines were given to the oldest commit looked at.
      truncated: boolean;
    };

export interface PickInfo {
  oid: string;
  subject: string;
}

export type Operation =
  | { kind: 'rebase'; onto: string; branch: string; step: number; total: number; current: PickInfo | null }
  | { kind: 'cherry-pick'; current: PickInfo };

// What a cherry-pick or rebase (or one more step of it) did.
export type PickResult =
  | { status: 'done'; commit: string | null; skipped: PickInfo[] }
  | { status: 'conflict'; conflicts: string[]; current: PickInfo; step?: number; total?: number }
  | { status: 'empty'; current: PickInfo }
  | { status: 'up-to-date' | 'fast-forward' };

export interface StashEntry {
  index: number;
  oid: string;
  message: string;
  timestamp: number;
  parents: string[];
}

export interface StashApplied {
  conflicts: string[];
  files: string[];
  dropped?: boolean;
}

export interface Tag {
  name: string;
  // The commit it points at.
  oid: string;
  annotated: boolean;
  message: string | null;
}

export interface MergeResult {
  conflicts: string[];
  fastForward: boolean;
  alreadyMerged: boolean;
}

export const isStaged = (c: FileChange) => c.code !== '??' && c.code !== 'UU' && c.code[0] !== ' ';
export const isUnstaged = (c: FileChange) => c.code === '??' || c.code === 'UU' || c.code[1] !== ' ';

// UTF-8 text as base64, for passing file contents and messages as arguments.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64(text: string): string {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export type RunGit = (args: string[]) => Promise<GitResult>;

export function createGitPro(run: RunGit) {
  async function call<T>(...args: string[]): Promise<T> {
    const r = await run(['__tide', ...args]);
    if (r.code !== 0) throw new Error(lastLines(r.stderr).replace(/^fatal: /, '') || 'git failed');
    const last = r.stdout.trim().split('\n').pop() ?? 'null';
    return JSON.parse(last) as T;
  }
  return {
    status: () => call<Status>('status'),
    show: (path: string) => call<FileVersions>('show', path),
    stage: (paths: string[]) => call<null>('stage', ...paths),
    stageText: (path: string, text: string) => call<null>('stage-text', path, base64(text)),
    unstage: (paths: string[]) => call<null>('unstage', ...paths),
    discard: (paths: string[]) => call<null>('discard', ...paths),
    commit: (message: string) => call<{ oid: string; files: number }>('commit', base64(message)),
    branches: () => call<Branches>('branches'),
    createBranch: (name: string) => call<null>('create-branch', name),
    checkout: (ref: string) => call<null>('checkout', ref),
    deleteBranch: (name: string) => call<null>('delete-branch', name),
    merge: (branch: string) => call<MergeResult>('merge', branch),
    abortMerge: () => call<null>('abort-merge'),
    log: (n = 50) => call<CommitInfo[]>('log', String(n)),
    commitFiles: (oid: string) => call<{ path: string; status: 'added' | 'deleted' | 'modified' }[]>('commit-files', oid),
    commitFile: (oid: string, path: string) => call<CommitFileVersions>('commit-file', oid, path),
    fileLog: (path: string, n = 100) => call<CommitInfo[]>('file-log', path, String(n)),
    blame: (path: string) => call<Blame>('blame', path),
    push: () => call<null>('push'),
    stashes: () => call<StashEntry[]>('stashes'),
    stashPush: (message = '', untracked = false) => call<{ oid: string; message: string } | null>('stash-push', base64(message), untracked ? '1' : '0'),
    stashApply: (n: number) => call<StashApplied>('stash-apply', String(n)),
    stashPop: (n: number) => call<StashApplied>('stash-pop', String(n)),
    stashDrop: (n: number) => call<null>('stash-drop', String(n)),
    tags: () => call<Tag[]>('tags'),
    // A message makes an annotated tag.
    createTag: (name: string, message = '', target = 'HEAD') => call<null>('create-tag', name, base64(message), target),
    deleteTag: (name: string) => call<null>('delete-tag', name),
    pushTag: (name: string) => call<null>('push-tag', name),
    cherryPick: (oid: string) => call<PickResult>('cherry-pick', oid),
    cherryPickContinue: () => call<PickResult>('cherry-pick-continue'),
    cherryPickAbort: () => call<null>('cherry-pick-abort'),
    rebase: (upstream: string) => call<PickResult>('rebase', upstream),
    rebaseContinue: () => call<PickResult>('rebase-continue'),
    rebaseSkip: () => call<PickResult>('rebase-skip'),
    rebaseAbort: () => call<null>('rebase-abort'),
    // Pull prints progress, not JSON; it's the porcelain command.
    async pull() {
      const r = await run(['pull']);
      if (r.code !== 0) throw new Error(lastLines(r.stderr).replace(/^fatal: /, '') || 'pull failed');
    },
  };
}

export type GitPro = ReturnType<typeof createGitPro>;
