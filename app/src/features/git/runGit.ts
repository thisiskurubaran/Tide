import type { Runner } from '../../runtime/runner';
import { joinPath } from '../files/fs';
import { PROJECTS_DIR } from '../files/workspace';
import { gitEnv } from './settings';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

let next = 0;

// Runs the built-in git for the Source Control sheet and cloning, outside the terminal.
export function runGit(runner: Runner, project: string, args: string[], env: Record<string, string> = gitEnv()): Promise<GitResult> {
  const id = `git-ui-${++next}`;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    runner.run(
      { type: 'run', id, runtime: 'node', entry: 'tide:git', cwd: joinPath(PROJECTS_DIR, project), args, env },
      (msg) => {
        if (msg.type === 'stdout') stdout += msg.data;
        else if (msg.type === 'stderr') stderr += msg.data;
        else if (msg.type === 'exit') resolve({ code: msg.code ?? 1, stdout, stderr });
      },
    );
  });
}

// Progress lines redraw with \r; keep only what the last redraw left.
export const lastLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.slice(l.lastIndexOf('\r') + 1).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''))
    .filter(Boolean)
    .join('\n');

// Project name from a clone URL: https://github.com/a/b.git -> b
export const repoName = (url: string) =>
  url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .pop() ?? '';
