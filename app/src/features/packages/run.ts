import type { Runner } from '../../runtime/runner';
import { joinPath } from '../files/fs';
import { PROJECTS_DIR } from '../files/workspace';
import { lastLines } from '../git/runGit';
import type { Ecosystem } from './packages';

let next = 0;

// Runs the built-in npm or pip (the local shell's) in the project, passing
// output along as it comes.
export function runTool(runner: Runner, project: string, tool: Ecosystem, args: string[], onOutput: (text: string) => void): Promise<number> {
  const id = `packages-${++next}`;
  return new Promise((resolve) => {
    runner.run({ type: 'run', id, runtime: 'node', entry: `tide:${tool}`, cwd: joinPath(PROJECTS_DIR, project), args }, (msg) => {
      if (msg.type === 'stdout' || msg.type === 'stderr') onOutput(msg.data);
      else if (msg.type === 'exit') resolve(msg.code ?? 1);
    });
  });
}

export const tidyOutput = (text: string) => lastLines(text);
