import { createStore, useStore } from 'zustand';

import type { GitResult } from './runGit';

// Each project's branch and changed files, from the built-in git. Read by the
// status bar, the activity bar's badge, the file tree's colors and the
// project cards on the home screen. Refreshed on open, after saves and when
// Source Control closes, never on a timer.
export interface GitStatus {
  // Null before the first commit, when git has no branch to name.
  branch: string | null;
  // Porcelain code per path: 'M ', ' M', '??', 'A ', 'D '…
  changes: Record<string, string>;
}

export interface GitStatusState {
  byProject: Record<string, GitStatus | null>;
  refresh(project: string): Promise<void>;
}

export type GitRun = (project: string, args: string[]) => Promise<{ code: number; stdout: string }>;

export function parseStatus(status: string, branchOut: string): GitStatus {
  const name = /^\* (?:\x1b\[[0-9;]*m)?([^\x1b\n]+)/m.exec(branchOut)?.[1]?.trim();
  const branch = name && !name.startsWith('(') ? name : null;
  const changes: Record<string, string> = {};
  for (const line of status.split('\n')) {
    if (line.length < 4) continue;
    // Renames read "old -> new"; the new path is the one in the tree.
    const path = line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, '');
    changes[path] = line.slice(0, 2);
  }
  return { branch, changes };
}

// 'M' modified, 'U' untracked or added, 'D' deleted, for the file tree.
export function changeLetter(code: string | undefined): 'M' | 'U' | 'D' | null {
  if (!code) return null;
  if (code === '??' || code.includes('A')) return 'U';
  if (code.includes('D')) return 'D';
  return 'M';
}

export function createGitStatusStore(run: GitRun) {
  const inFlight = new Map<string, Promise<void>>();
  return createStore<GitStatusState>()((set) => ({
    byProject: {},
    refresh(project) {
      const pending = inFlight.get(project);
      if (pending) return pending;
      const p = (async () => {
        try {
          const st = await run(project, ['status', '-s']);
          if (st.code !== 0) {
            set((s) => ({ byProject: { ...s.byProject, [project]: null } }));
            return;
          }
          const br = await run(project, ['branch']);
          const next = parseStatus(st.stdout, br.stdout);
          set((s) => ({ byProject: { ...s.byProject, [project]: next } }));
        } catch {
          set((s) => ({ byProject: { ...s.byProject, [project]: null } }));
        } finally {
          inFlight.delete(project);
        }
      })();
      inFlight.set(project, p);
      return p;
    },
  }));
}

// The runtime loads on first refresh, so importing this (tests, the home
// screen) doesn't start Node.
export const gitStatusStore = createGitStatusStore((project, args): Promise<GitResult> => {
  const { localRunner } = require('../../runtime') as typeof import('../../runtime');
  const { runGit } = require('./runGit') as typeof import('./runGit');
  return runGit(localRunner, project, args);
});

export const useGitStatus = <T>(selector: (s: GitStatusState) => T) => useStore(gitStatusStore, selector);
