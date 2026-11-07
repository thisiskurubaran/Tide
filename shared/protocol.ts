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
// App -> server once per connection: the whole project, before the shell is
// used. Sent in batches that each stay under SyncLimits['initBatchBytes'] of file
// data; every batch but the last has `more: true`. Flow control: the server
// answers each `more` batch with 'init-ack' once it has applied it, and the app
// sends the next batch only after that ack (so no more than one batch is ever
// queued in the phone's socket). The server answers 'ready' after the last one.
// A single init without `more` is the whole project.
//
// The server reconciles the init against the container (three-way, using the
// content it last saw both sides agree on, kept per session across reconnects):
// a side that changed wins over one that didn't; when both changed, the
// container's file keeps its name and the phone's version is written next to it
// as `<name>.phone-conflict` (both are then sent to the app). Container changes
// made while disconnected reach the app as 'file' / 'delete' before 'ready'.
export type SyncInit = { type: 'init'; files: { path: string; data: string }[]; more?: boolean };
// Server -> app: the init batch before this was applied; send the next one.
export type SyncInitAck = { type: 'init-ack' };
// App -> server, once for every 'file' or 'delete' the server sent, in order,
// after applying it. `ok: false` means the app could not store it (an invalid
// name on the phone, a full disk): the app then treats the path as container-owned
// (like 'skipped'), and the server never deletes it on the app's behalf.
export type SyncAck = { type: 'ack'; path: string; ok: boolean };
// Server -> app: the set of ports something is listening on in the container.
export type SyncPorts = { type: 'ports'; ports: number[] };
// Server -> app: the container owns `path`: its copy is over SyncLimits['maxBytes'],
// or it is a symlink (or inside a symlinked folder), so it is not synced. The
// container's copy wins: the app stops sending that path (and the server drops
// writes to it) until that changes, which the app learns from a 'file' or
// 'delete' for it.
export type SyncSkipped = { type: 'skipped'; path: string };

export type SyncToServer = SyncInit | SyncFile | SyncDelete | SyncAck;
export type SyncToApp = SyncFile | SyncDelete | SyncPorts | SyncSkipped | SyncInitAck | { type: 'ready' };

// This file holds types only (shared/ is loaded as CommonJS by the server's
// typecheck), so sync constants are literal types that each side's runtime
// values are checked against.
export type SyncLimits = {
  // Files bigger than this aren't synced either way.
  maxBytes: 2097152;
  // Budget for the base64 file data in one init batch. The server's WebSocket
  // message limit is 64 MB; one batch is at most this plus one file.
  initBatchBytes: 8388608;
};

// Folders never synced, at any depth: dependencies, VCS data, and build or
// tool caches that are regenerated in the container and can be huge. 'dist',
// 'build' and 'out' are deliberately not here, since some projects keep
// sources or checked-in assets in them (batched init keeps big ones safe).
// The runtime lists (server/src/syncRules.ts, app/src/features/remote/syncRules.ts)
// must name exactly these (checked by tsc); server/src/watcher.py has a copy
// that a server test compares.
export type SyncSkipDir =
  | 'node_modules'
  | '.git'
  | '__pycache__'
  | '.pylibs'
  | '.venv'
  | 'venv'
  | '.cache'
  | '.next'
  | '.nuxt'
  | '.svelte-kit'
  | '.turbo'
  | '.parcel-cache'
  | '.angular'
  | '.expo'
  | '.gradle'
  | '.dart_tool'
  | '.pytest_cache'
  | '.mypy_cache'
  | '.ruff_cache'
  | '.tox'
  | '.nyc_output'
  | 'coverage'
  | 'target';

// Resolves to T only when T lists every SyncSkipDir (use with `satisfies`).
export type AllSyncSkipDirs<T extends readonly SyncSkipDir[]> = [Exclude<SyncSkipDir, T[number]>] extends [never] ? T : never;

// POST /sessions response.
export type SessionInfo = { id: string; project: string; previewBase: string };
