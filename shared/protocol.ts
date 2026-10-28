// Messages spoken by every runner (local Node, local Python, remote). The
// terminal UI only knows these types, never which runner is behind them.

export type Runtime = 'node' | 'python';

// Optional per-run caps. Local runners apply defaults when they are missing.
export type RunLimits = { maxMemoryMb?: number; timeoutMs?: number };

export type RunRequest = {
  type: 'run';
  id: string;
  runtime: Runtime;
  entry: string;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  limits?: RunLimits;
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

// Local Node supervisor only (the nodejs-mobile channel), next to the runner messages above.
// `root` is the absolute path that RunRequest `entry` and `cwd` are relative to.
export type SupervisorRequest = { type: 'init'; root: string } | { type: 'ping' };

export type SupervisorEvent =
  | { type: 'ready'; node: string }
  | { type: 'pong'; node: string; platform: string; arch: string };

// Remote file sync (WebSocket /sessions/:id/sync), both directions. Paths are
// relative to the project root; contents are base64 so binary files survive.
export type SyncFile = { type: 'file'; path: string; data: string };
export type SyncDelete = { type: 'delete'; path: string };
// App -> server once per connection: the whole project, before the shell is used.
export type SyncInit = { type: 'init'; files: { path: string; data: string }[] };
// Server -> app: the set of ports something is listening on in the container.
export type SyncPorts = { type: 'ports'; ports: number[] };

export type SyncToServer = SyncInit | SyncFile | SyncDelete;
export type SyncToApp = SyncFile | SyncDelete | SyncPorts | { type: 'ready' };

// POST /sessions response.
export type SessionInfo = { id: string; project: string; previewBase: string };
