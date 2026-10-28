// Messages spoken by every runner (local Node, local Python, remote). The
// terminal UI only knows these types, never which runner is behind them.

export type Runtime = 'node' | 'python';

export type RunRequest = {
  type: 'run';
  id: string;
  runtime: Runtime;
  entry: string;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
};

export type StdinMsg = { type: 'stdin'; id: string; data: string };

export type KillMsg = { type: 'kill'; id: string };

export type OutputMsg = { type: 'stdout' | 'stderr'; id: string; data: string };

export type ExitMsg = { type: 'exit'; id: string; code: number; signal?: string };

// Remote only: the PTY is a raw byte stream sized by the terminal.
export type ResizeMsg = { type: 'resize'; cols: number; rows: number };

export type PtyData = { type: 'pty'; data: string };

export type ClientMessage = RunRequest | StdinMsg | KillMsg | ResizeMsg | PtyData;

export type RunnerMessage = OutputMsg | ExitMsg | PtyData;
