import crypto from 'node:crypto';
import fs from 'node:fs';
import { Duplex, PassThrough } from 'node:stream';

import type Docker from 'dockerode';

import type { Config } from './config.ts';
import { WORKSPACE } from './paths.ts';
import { packTar } from './tar.ts';

const LABEL = 'dev.tide.session';
const RELAY = fs.readFileSync(new URL('./relay.py', import.meta.url), 'utf8');
export const WATCHER = fs.readFileSync(new URL('./watcher.py', import.meta.url), 'utf8');

export interface Session {
  id: string;
  project: string;
  container: Docker.Container;
  // Unguessable path segment for previews, since a WebView can't send our auth header.
  previewKey: string;
  lastActive: number;
  connections: number;
  ports: number[];
}

export class SessionManager {
  private sessions = new Map<string, Session>();
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
  async open(project: string): Promise<Session> {
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

  async writeFiles(session: Session, files: { path: string; data: Buffer }[]) {
    if (!files.length) return;
    await session.container.putArchive(packTar(files), { path: WORKSPACE });
  }

  async run(session: Session, cmd: string[]) {
    const exec = await session.container.exec({ Cmd: cmd, User: 'tide', AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.resume();
    await new Promise((resolve) => stream.on('end', resolve));
    return (await exec.inspect()).ExitCode ?? 1;
  }

  // Long-running exec whose stdout is demuxed; used for the watcher.
  async spawn(session: Session, cmd: string[]): Promise<{ stdout: PassThrough; stop(): void }> {
    const exec = await session.container.exec({ Cmd: cmd, User: 'tide', AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    this.docker.modem.demuxStream(stream, stdout, new PassThrough());
    stream.on('end', () => stdout.end());
    return { stdout, stop: () => stream.destroy() };
  }

  // A TCP connection to `port` inside the container, carried over an exec.
  async connect(session: Session, port: number): Promise<Duplex> {
    const exec = await session.container.exec({
      Cmd: ['python3', '-u', '-c', RELAY, String(port)],
      User: 'tide',
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: true })) as Duplex;
    const stdout = new PassThrough();
    this.docker.modem.demuxStream(stream, stdout, new PassThrough());
    stream.on('end', () => stdout.end());
    // Writes go to the exec's stdin, reads come from the demuxed stdout.
    const socket = new Duplex({
      write(chunk, _enc, cb) {
        stream.write(chunk, cb);
      },
      read() {
        stdout.resume();
      },
      destroy(err, cb) {
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
