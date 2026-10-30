import type { RunnerMessage } from '@shared/protocol';

import type { Runner } from './runner';

let next = 0;

// Runs a built-in Node tool (tide:<name>) to completion and returns what it
// printed; a non-zero exit rejects with its error output.
export function runTool(runner: Runner, name: string, args: string[] = [], env: Record<string, string> = {}): Promise<string> {
  const id = `tool-${name}-${Date.now()}-${++next}`;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    runner.run({ type: 'run', id, runtime: 'node', entry: `tide:${name}`, cwd: '', args, env }, (msg: RunnerMessage) => {
      if (msg.type === 'stdout') stdout += msg.data;
      else if (msg.type === 'stderr') stderr += msg.data;
      else if (msg.type === 'exit') (msg.code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `tide:${name} failed`)));
    });
  });
}
