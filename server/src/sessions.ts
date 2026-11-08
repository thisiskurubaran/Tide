import crypto from 'node:crypto';
import fs from 'node:fs';
import { Duplex, PassThrough, Transform } from 'node:stream';

import type Docker from 'dockerode';

import type { Config } from './config.ts';
import { WORKSPACE } from './paths.ts';
import { packTar, type TarFile } from './tar.ts';

const LABEL = 'dev.tide.session';
const RELAY = fs.readFileSync(new URL('./relay.py', import.meta.url), 'utf8');
export const WATCHER = fs.readFileSync(new URL('./watcher.py', import.meta.url), 'utf8');

// Long-lived execs start through sh, which prints its PID before exec'ing the
// real command. Destroying an exec's stream leaves its processes running in the
// container (a server started in an old shell kept its port, and Ctrl-C in the
// new shell couldn't reach it), so on close the exec's whole session is killed.
// Each docker exec is its own session: pkill -s also catches jobs it started.
export const withPid = (cmd: string[]) => ['sh', '-c', 'echo "TIDE_PID=$$"; exec "$@"', 'sh', ...cmd];

// Removes the PID line from the start of an exec's output and reports the PID.
export function stripPid(onPid: (pid: number) => void): Transform {
  let head: Buffer | null = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (head === null) return cb(null, chunk);
      head = Buffer.concat([head, chunk]);
      const nl = head.indexOf(10);
      if (nl === -1 && head.length < 64) return cb();
      const m = /^TIDE_PID=(\d+)\r?$/.exec(head.subarray(0, nl === -1 ? 0 : nl).toString());
      const rest = m ? head.subarray(nl + 1) : head;
      if (m) onPid(Number(m[1]));
      head = null;
      cb(null, rest.length ? rest : undefined);
    },
  });
}

// How long a run() or output() exec may take before it is given up on.
export const EXEC_TIMEOUT_MS = 60_000;

// Settles once an exec's stream is done: resolves on 'end' or 'close', rejects
// on 'error' or after `ms` (destroying the stream). Waiting for 'end' alone
// hung forever when the stream errored, which stalled the whole sync chain.
export function streamDone(stream: NodeJS.ReadableStream & { destroy?(err?: Error): void }, ms = EXEC_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      done();
      stream.destroy?.();
      reject(new Error(`container command timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    const ok = () => {
      done();
      resolve();
    };
    const fail = (e: Error) => {
      done();
      reject(e);
    };
    const done = () => {
      clearTimeout(timer);
      stream.off('end', ok);
      stream.off('close', ok);
      stream.off('error', fail);
      // A late error must not crash the process once nothing listens for it.
      stream.on('error', () => undefined);
    };
    stream.on('end', ok);
    stream.on('close', ok);
    stream.on('error', fail);
  });
}

// Folders the container has, as far as the watcher's reports tell: the parents
// of every file it reported (session.modes) and of every path it owns.
export function existingDirs(session: Pick<Session, 'modes' | 'skipped'>): (dir: string) => boolean {
  const dirs = new Set<string>();
  const add = (p: string) => {
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i));
  };
  for (const p of session.modes.keys()) add(p);
  for (const p of session.skipped) add(p);
  return (dir) => dirs.has(dir);
}

export interface Session {
  id: string;
  project: string;
  container: Docker.Container;
  // Unguessable path segment for previews, since a WebView can't send our auth header.
  previewKey: string;
  lastActive: number;
  connections: number;
  ports: number[];
  // Paths the container owns: files over SyncLimits['maxBytes'] and symlinks
  // (a folder symlink covers everything under it). The container's copy wins:
  // writes from the app to these paths are dropped (an app delete or rename of
  // one is carried out: see ownedDeletes in sync.ts).
  skipped: Set<string>;
  // Sync record, kept across reconnects while the container lives: the content
  // hash (sha1 of the bytes) of each path as last agreed between the app and the
  // container, the base of the three-way reconcile at init. null until the first
  // init, which is then a plain phone-wins copy.
  agreed: Map<string, string> | null;
  // Permission bits of container files, as the watcher last reported them, so
  // writes from the app keep them (an executable ./gradlew stays executable).
  modes: Map<string, number>;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private opening = new Map<string, Promise<Session>>();
  private sweeper: NodeJS.Timeout | null = null;

  private docker: Docker;
  private config: Config;

  constructor(docker: Docker, config: Config) {
    this.docker = docker;
    this.config = config;
  }

  // Containers left over from an earlier server run have no live connections; remove them.
  async start() {
    const stale = await this.docker.listContainers({ all: true, filters: { label: [LABEL] } });
    await Promise.all(stale.map((c) => this.docker.getContainer(c.Id).remove({ force: true }).catch(() => undefined)));
    this.sweeper = setInterval(() => void this.sweep(), 30_000);
    this.sweeper.unref();
  }

  async stop() {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.remove(id)));
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  byPreviewKey(key: string) {
    for (const s of this.sessions.values()) if (s.previewKey === key) return s;
    return undefined;
  }

  list() {
    return [...this.sessions.values()];
  }

  // One container per project: reconnecting after the app was backgrounded gets the same one.
  // Concurrent opens of one project (two sockets racing at reconnect) share one
  // attempt, so they can't each create a container.
  open(project: string): Promise<Session> {
    const pending = this.opening.get(project);
    if (pending) return pending;
    const attempt = this.openNow(project).finally(() => this.opening.delete(project));
    this.opening.set(project, attempt);
    return attempt;
  }

  private async openNow(project: string): Promise<Session> {
    for (const s of this.sessions.values()) {
      if (s.project === project) {
        const state = await s.container.inspect().catch(() => null);
        if (state?.State.Running) {
          this.touch(s);
          return s;
        }
        await this.remove(s.id);
      }
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const container = await this.docker.createContainer({
      name: `tide-${id}`,
      Image: this.config.image,
      Labels: { [LABEL]: '1', [`${LABEL}.project`]: project },
      User: 'tide',
      WorkingDir: WORKSPACE,
      Env: ['TERM=xterm-256color', 'LANG=C.UTF-8', 'HOME=/home/tide'],
      HostConfig: {
        Memory: this.config.memoryBytes,
        MemorySwap: this.config.memoryBytes,
        NanoCpus: Math.round(this.config.cpus * 1e9),
        PidsLimit: this.config.pids,
        Privileged: false,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        // Default bridge network: outbound only, nothing is published to the host.
        NetworkMode: 'bridge',
        Init: true,
      },
    });
    await container.start();
    const session: Session = {
      id,
      project,
      container,
      previewKey: crypto.randomBytes(18).toString('base64url'),
      lastActive: Date.now(),
      connections: 0,
      ports: [],
      skipped: new Set(),
      agreed: null,
      modes: new Map(),
    };
    this.sessions.set(id, session);
    return session;
  }

  touch(session: Session) {
    session.lastActive = Date.now();
  }

  async remove(id: string) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    await s?.container.remove({ force: true }).catch(() => undefined);
  }

  private async sweep() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.connections === 0 && now - s.lastActive > this.config.idleMs) await this.remove(s.id);
    }
  }

  // Writes files under `dir` (default: the workspace; it must exist). Gives up
  // after `timeoutMs`, like run() and output(), so a stuck docker call can't
  // stall the sync chain forever.
  async writeFiles(session: Session, files: TarFile[], opts: { dir?: string; timeoutMs?: number } = {}) {
    if (!files.length) return;
    const dir = opts.dir ?? WORKSPACE;
    const tar = packTar(files, dir === WORKSPACE ? existingDirs(session) : undefined);
    const ms = opts.timeoutMs ?? EXEC_TIMEOUT_MS;
    const abort = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error(`container write timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
    });
    try {
      await Promise.race([session.container.putArchive(tar, { path: dir, abortSignal: abort.signal } as never), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Moves files (absolute paths) inside the container as the tide user,
  // creating each destination's folders.
  async moveFiles(session: Session, pairs: [from: string, to: string][]) {
    const script = 'while [ $# -gt 1 ]; do mkdir -p -- "$(dirname -- "$2")" && mv -fT -- "$1" "$2" || exit 1; shift 2; done';
    for (let i = 0; i < pairs.length; i += 128) {
      if ((await this.run(session, ['sh', '-c', script, 'sh', ...pairs.slice(i, i + 128).flat()])) !== 0) throw new Error('could not move files in the container');
    }
  }

  // Stops an exec started with withPid, and everything it started.
  killExec(session: Session, pid: number) {
    const script = `pkill -HUP -s ${pid}; sleep 1; pkill -KILL -s ${pid}; true`;
    this.run(session, ['sh', '-c', script]).catch(() => undefined);
  }

  // Calls back with a stop function once the PID is known; stopping before that kills it as soon as it is.
  private stopper(session: Session) {
    let pid: number | null = null;
    let stopped = false;
    return {
      onPid: (p: number) => {
        pid = p;
        if (stopped) this.killExec(session, p);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (pid !== null) this.killExec(session, pid);
      },
    };
  }

  async run(session: Session, cmd: string[], timeoutMs = EXEC_TIMEOUT_MS) {
    const exec = await session.container.exec({ Cmd: cmd, User: 'tide', AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.resume();
    await streamDone(stream, timeoutMs);
    return (await exec.inspect()).ExitCode ?? 1;
  }

  // Runs a command to completion and returns its stdout.
  async output(session: Session, cmd: string[], timeoutMs = EXEC_TIMEOUT_MS): Promise<string> {
    const exec = await session.container.exec({ Cmd: cmd, User: 'tide', AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (d: Buffer) => chunks.push(d));
    this.docker.modem.demuxStream(stream, out, new PassThrough());
    await streamDone(stream, timeoutMs);
    return Buffer.concat(chunks).toString('utf8');
  }

  // Long-running exec whose stdout is demuxed; used for the watcher.
  async spawn(session: Session, cmd: string[]): Promise<{ stdout: Transform; stop(): void }> {
    const exec = await session.container.exec({ Cmd: withPid(cmd), User: 'tide', AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    const { onPid, stop } = this.stopper(session);
    const raw = new PassThrough();
    this.docker.modem.demuxStream(stream, raw, new PassThrough());
    // Ends stdout however the stream finishes, so a watcher that dies before its
    // snapshot rejects the sync's wait instead of hanging it.
    const finish = () => !raw.writableEnded && raw.end();
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
    const stdout = raw.pipe(stripPid(onPid));
    return {
      stdout,
      stop: () => {
        stop();
        stream.destroy();
      },
    };
  }

  // A TTY exec (the terminal's shell): raw output with the PID line removed.
  async spawnTty(session: Session, cmd: string[], env: string[]) {
    const exec = await session.container.exec({
      Cmd: withPid(cmd),
      User: 'tide',
      WorkingDir: WORKSPACE,
      Env: env,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as Duplex;
    const { onPid, stop } = this.stopper(session);
    const output = stream.pipe(stripPid(onPid));
    return {
      exec,
      input: stream,
      output,
      stop: () => {
        stop();
        stream.destroy();
      },
    };
  }

  // A TCP connection to `port` inside the container, carried over an exec.
  async connect(session: Session, port: number): Promise<Duplex> {
    const exec = await session.container.exec({
      Cmd: withPid(['python3', '-u', '-c', RELAY, String(port)]),
      User: 'tide',
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: true })) as Duplex;
    const { onPid, stop } = this.stopper(session);
    const raw = new PassThrough();
    this.docker.modem.demuxStream(stream, raw, new PassThrough());
    stream.on('end', () => raw.end());
    const stdout = raw.pipe(stripPid(onPid));
    // Writes go to the exec's stdin, reads come from the demuxed stdout.
    const socket = new Duplex({
      write(chunk, _enc, cb) {
        stream.write(chunk, cb);
      },
      read() {
        stdout.resume();
      },
      destroy(err, cb) {
        stop();
        stream.destroy();
        cb(err);
      },
    });
    stdout.on('data', (d) => {
      if (!socket.push(d)) stdout.pause();
    });
    stdout.on('end', () => socket.push(null));
    stream.on('error', (e) => socket.destroy(e));
    return socket;
  }
}
