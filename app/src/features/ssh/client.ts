import type { RunnerMessage } from '@shared/protocol';

import type { Runner } from '../../runtime/runner';
import type { TerminalBackend } from '../terminal/backend';
import { ansi } from '../terminal/shell/ansi';

let next = 0;
const runId = (kind: string) => `ssh-${kind}-${Date.now()}-${++next}`;
// Sessions stay open as long as the user wants; no time limit.
const LIMITS = { timeoutMs: 0 };

// Runs tide:ssh once and returns what it printed (keygen, pubkey).
export function runSshTool(runner: Runner, mode: string, config: object): Promise<string> {
  const id = runId(mode);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    runner.run({ type: 'run', id, runtime: 'node', entry: 'tide:ssh', cwd: '', args: [mode], env: { TIDE_SSH: JSON.stringify(config) } }, (msg: RunnerMessage) => {
      if (msg.type === 'stdout') stdout += msg.data;
      else if (msg.type === 'stderr') stderr += msg.data;
      else if (msg.type === 'exit') (msg.code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `tide:ssh ${mode} failed`)));
    });
  });
}

// "TIDE-HOSTKEY <fp>" for the server, "TIDE-HOSTKEY-JUMP <fp>" for the jump host.
const HOSTKEY = /^TIDE-HOSTKEY(-JUMP)? (\S+)$/;
export type HostKeyFor = 'server' | 'jump';

// Lines tide:ssh writes to stderr: the host key line goes to `onHostKey`,
// everything else is shown.
function stderrLines(onLine: (line: string) => void) {
  let buffer = '';
  return (data: string) => {
    buffer += data;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      onLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  };
}

// An SSH shell in a terminal pane. Keys go straight to the remote PTY, which
// does the line editing, history and completion.
export class SshBackend implements TerminalBackend {
  private id: string | null = null;
  private size = { cols: 80, rows: 24 };

  constructor(
    private runner: Runner,
    private label: string,
    private config: () => Promise<object>,
    private write: (data: string) => void,
    private onHostKey: (fingerprint: string, which: HostKeyFor) => void,
    private onExit?: () => void,
  ) {}

  start() {
    this.write(`${ansi.dim}Connecting to ${this.label}...${ansi.reset}\r\n`);
    this.config().then(
      (config) => {
        const id = runId('shell');
        this.id = id;
        const errors = stderrLines((line) => {
          const m = HOSTKEY.exec(line);
          if (m) {
            this.onHostKey(m[2], m[1] ? 'jump' : 'server');
            this.write(`${ansi.dim}${m[1] ? 'Jump host' : 'Host'} key ${m[2]} saved for next time.${ansi.reset}\r\n`);
          } else this.write(`${ansi.red}${line}${ansi.reset}\r\n`);
        });
        this.runner.run(
          { type: 'run', id, runtime: 'node', entry: 'tide:ssh', cwd: '', args: ['shell'], env: { TIDE_SSH: JSON.stringify({ ...config, ...this.size }) }, limits: LIMITS },
          (msg: RunnerMessage) => {
            if (msg.type === 'stdout') this.write(msg.data);
            else if (msg.type === 'stderr') errors(msg.data);
            else if (msg.type === 'exit') {
              if (this.id !== id) return;
              this.id = null;
              this.write(`\r\n${ansi.dim}Connection closed.${ansi.reset}\r\n`);
              this.onExit?.();
            }
          },
        );
      },
      (e) => this.write(`${ansi.red}${e instanceof Error ? e.message : String(e)}${ansi.reset}\r\n`),
    );
  }

  input(data: string) {
    if (this.id) this.runner.send({ type: 'stdin', id: this.id, data });
  }

  resize(cols: number, rows: number) {
    this.size = { cols, rows };
    if (this.id) this.runner.send({ type: 'stdin', id: this.id, data: `\x1b]tide-resize;${cols};${rows}\x07` });
  }

  dispose() {
    if (this.id) this.runner.send({ type: 'kill', id: this.id });
    this.id = null;
  }
}

export interface RemoteEntry {
  name: string;
  kind: 'dir' | 'file' | 'link';
  size: number;
  mtime: number;
}

// One SFTP connection, kept open while a files screen is showing.
export class SftpSession {
  private id = runId('sftp');
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private buffer = '';
  private ready: Promise<void>;
  private closed = false;

  constructor(
    private runner: Runner,
    config: object,
    onHostKey: (fingerprint: string, which: HostKeyFor) => void,
  ) {
    let markReady: () => void = () => undefined;
    let fail: (e: Error) => void = () => undefined;
    this.ready = new Promise((resolve, reject) => {
      markReady = resolve;
      fail = reject;
    });
    let errorText = '';
    const errors = stderrLines((line) => {
      const m = HOSTKEY.exec(line);
      if (m) onHostKey(m[2], m[1] ? 'jump' : 'server');
      else errorText += `${line}\n`;
    });
    runner.run({ type: 'run', id: this.id, runtime: 'node', entry: 'tide:ssh', cwd: '', args: ['sftp'], env: { TIDE_SSH: JSON.stringify(config) }, limits: LIMITS }, (msg: RunnerMessage) => {
      if (msg.type === 'stderr') errors(msg.data);
      else if (msg.type === 'stdout') {
        this.buffer += msg.data;
        let nl;
        while ((nl = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 1);
          let reply: any;
          try {
            reply = JSON.parse(line);
          } catch {
            continue;
          }
          if (reply.ready) markReady();
          const w = this.waiting.get(reply.id);
          if (!w) continue;
          this.waiting.delete(reply.id);
          if (reply.ok) w.resolve(reply.result);
          else w.reject(new Error(reply.error));
        }
      } else if (msg.type === 'exit') {
        this.closed = true;
        const e = new Error(errorText.trim() || 'The connection closed.');
        fail(e);
        this.waiting.forEach((w) => w.reject(e));
        this.waiting.clear();
      }
    });
  }

  async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.ready;
    if (this.closed) throw new Error('The connection closed.');
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.runner.send({ type: 'stdin', id: this.id, data: `${JSON.stringify({ id, op, ...args })}\n` });
    });
  }

  list = (path: string) => this.request<RemoteEntry[]>('list', { path });
  realpath = (path: string) => this.request<string>('realpath', { path });
  read = (path: string) => this.request<{ base64: string }>('read', { path });
  writeFile = (path: string, base64: string) => this.request<boolean>('write', { path, base64 });
  mkdir = (path: string) => this.request<void>('mkdir', { path });
  rename = (path: string, to: string) => this.request<void>('rename', { path, to });
  remove = (path: string) => this.request<void>('remove', { path });

  close() {
    if (this.closed) return;
    this.closed = true;
    this.runner.send({ type: 'stdin', id: this.id, data: '{"op":"close"}\n' });
    setTimeout(() => this.runner.send({ type: 'kill', id: this.id }), 2000);
  }
}

// Local port forwarding: localhost:<localPort> on the device reaches
// <remoteHost>:<remotePort> on the server, until stopped.
export function startForward(
  runner: Runner,
  config: object,
  forward: { localPort: number; remoteHost: string; remotePort: number },
  on: { status(text: string): void; hostKey(fingerprint: string, which: HostKeyFor): void; exit(error: string | null): void },
): () => void {
  const id = runId('forward');
  let errorText = '';
  const errors = stderrLines((line) => {
    const m = HOSTKEY.exec(line);
    if (m) on.hostKey(m[2], m[1] ? 'jump' : 'server');
    else errorText += `${line}\n`;
  });
  runner.run(
    { type: 'run', id, runtime: 'node', entry: 'tide:ssh', cwd: '', args: ['forward'], env: { TIDE_SSH: JSON.stringify({ ...config, forward }) }, limits: LIMITS },
    (msg: RunnerMessage) => {
      if (msg.type === 'stdout') on.status(msg.data.trim());
      else if (msg.type === 'stderr') errors(msg.data);
      else if (msg.type === 'exit') on.exit(msg.code === 0 || msg.signal ? null : errorText.trim() || 'The connection closed.');
    },
  );
  return () => runner.send({ type: 'kill', id });
}
