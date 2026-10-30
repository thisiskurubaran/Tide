// Messages spoken by every runner (local Node, local Python, remote). The
// terminal UI only knows these types, never which runner is behind them.

// Lua runs on the Node runtime (fengari); Ruby and PHP on WebAssembly in a web view.
export type Runtime = 'node' | 'python' | 'lua' | 'ruby' | 'php';

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
  // Run under the debugger (local Node and Python only). Breakpoint files
  // are relative to the same root as `entry`; lines are 1-based.
  debug?: { breakpoints: Record<string, number[]> };
};

export type StdinMsg = { type: 'stdin'; id: string; data: string };

export type KillMsg = { type: 'kill'; id: string };

export type OutputMsg = { type: 'stdout' | 'stderr'; id: string; data: string };

export type ExitMsg = { type: 'exit'; id: string; code: number; signal?: string };

// Remote only: the PTY is a raw byte stream sized by the terminal.
export type ResizeMsg = { type: 'resize'; cols: number; rows: number };

export type PtyData = { type: 'pty'; data: string };

// Debugger (Debugger extension). The same commands and events for Node and Python.
export type DebugCommand =
  | { cmd: 'setBreakpoints'; file: string; lines: number[] }
  | { cmd: 'continue' }
  | { cmd: 'pause' }
  | { cmd: 'stepOver' }
  | { cmd: 'stepInto' }
  | { cmd: 'stepOut' }
  // `ref` comes from a scope or an expandable variable; answered by a 'variables' event with the same `req`.
  | { cmd: 'variables'; ref: number; req: number }
  // In the paused frame `frame` (0 is the top), answered by an 'evaluated' event.
  | { cmd: 'evaluate'; expression: string; frame: number; req: number };

export type DebugScope = { name: string; ref: number };

export type DebugFrame = {
  name: string;
  // Relative to the run's root, or null for runtime internals.
  file: string | null;
  line: number;
  column: number;
  scopes: DebugScope[];
};

// `ref` is 0 when the value has nothing to expand.
export type DebugVariable = { name: string; value: string; type: string; ref: number };

export type DebugEvent =
  | { event: 'stopped'; reason: string; frames: DebugFrame[] }
  | { event: 'resumed' }
  | { event: 'variables'; req: number; variables: DebugVariable[] }
  | { event: 'evaluated'; req: number; result?: DebugVariable; error?: string };

// Local runs only: a program started or stopped listening on a port.
export type PortMsg = { type: 'port'; id: string; port: number; open: boolean };

export type DebugCommandMsg = { type: 'debug'; id: string; command: DebugCommand };
export type DebugEventMsg = { type: 'debug'; id: string; event: DebugEvent };

export type ClientMessage = RunRequest | StdinMsg | KillMsg | ResizeMsg | PtyData | DebugCommandMsg;

export type RunnerMessage = OutputMsg | ExitMsg | PtyData | DebugEventMsg | PortMsg;

// Local Node supervisor only (the nodejs-mobile channel), next to the runner messages above.
// `root` is the absolute path that RunRequest `entry` and `cwd` are relative to.
export type SupervisorRequest = { type: 'init'; root: string } | { type: 'ping' };

export type SupervisorEvent =
  | { type: 'ready'; node: string }
  | { type: 'pong'; node: string; platform: string; arch: string };

// nodejs-mobile passes each channel message through a concurrent dispatch queue
// in both directions, so two messages sent back to back can arrive swapped (a
// run overtook the init that sets the root). Each side numbers what it sends,
// from 0, and the receiver delivers them in that order.
export type Envelope<T> = { n: number; m: T };

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
