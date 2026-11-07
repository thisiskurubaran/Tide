import type { SyncLimits, SyncToApp, SyncToServer } from '@shared/protocol';

import { isSyncSkipped, SYNC_MAX_BYTES } from './syncRules';

// What the sync needs from the workspace; the real one and tests both fit.
export interface SyncFiles {
  listFiles(project: string): Promise<string[]>;
  readBase64(project: string, path: string): Promise<string>;
  writeBase64(project: string, path: string, data: string): Promise<void>;
  removeIfPresent(project: string, path: string): Promise<void>;
}

export interface SyncHooks {
  // A file the editor may have open changed on disk.
  onFileChanged(path: string): void;
  // Files were added or removed; the tree should reload.
  onTreeChanged(): void;
  onPorts(ports: number[]): void;
  onReady(): void;
  // A file from the container could not be stored on the phone (an invalid
  // name, a full disk). The container keeps it; the phone leaves it alone.
  onSyncError?(path: string, message: string): void;
}

// Same limit as the server's watcher: bigger files aren't synced either way.
export const MAX_SYNC_BYTES = SYNC_MAX_BYTES;

// Bytes a base64 string decodes to. Compared with MAX_SYNC_BYTES rather than a
// base64 length, which can't tell 2097152 bytes from 2097153 (both encode to
// the same length) and so let a file through that the watcher calls oversize.
export function base64Bytes(data: string): number {
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}
// The init is sent in batches of about this much file data, so no message
// comes near the server's 64 MB limit however big the project is.
export const INIT_BATCH_BYTES: SyncLimits['initBatchBytes'] = 8388608;
// Same suffix the server gives the phone's side of a conflict.
export const CONFLICT_SUFFIX = '.phone-conflict';

// Keeps a project's files in step with its container. `known` holds the last
// content each side agreed on, so a change applied from one side is not sent
// straight back to it.
export class RemoteSync {
  private known = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private ready = false;
  private closed = false;
  // Local changes made before 'ready', sent once it arrives ('all' = full diff).
  private pending: Set<string> | 'all' | null = null;
  // Paths the container owns: its copy is too big to sync or a symlink, or the
  // phone failed to store it. Never sent (file, delete or init) until the
  // container sends a 'file' or 'delete' for them.
  private skipped = new Set<string>();
  // Resolves the wait for the server's 'init-ack' between init batches.
  private initAck: (() => void) | null = null;

  private socket: WebSocket;
  private project: string;
  private files: SyncFiles;
  private hooks: SyncHooks;

  constructor(socket: WebSocket, project: string, files: SyncFiles, hooks: SyncHooks) {
    this.socket = socket;
    this.project = project;
    this.files = files;
    this.hooks = hooks;
    socket.onopen = () => this.enqueue(() => this.sendInit());
    socket.onmessage = (e) => {
      let msg: SyncToApp;
      try {
        msg = JSON.parse(String(e.data)) as SyncToApp;
      } catch {
        return;
      }
      // Not queued: the init is waiting for it in the queue.
      if (msg.type === 'init-ack') return this.takeInitAck();
      this.enqueue(() => this.apply(msg));
    };
  }

  close() {
    this.closed = true;
    this.socket.close();
    this.takeInitAck();
  }

  private takeInitAck() {
    const resolve = this.initAck;
    this.initAck = null;
    resolve?.();
  }

  // Called after the app saved, created or deleted files. Diffing against
  // `known` catches renames and deletes made from the file tree too.
  changed(paths?: string[]) {
    if (!this.ready) {
      // The init may already have read these files; diff them after 'ready'.
      if (!paths) this.pending = 'all';
      else if (this.pending !== 'all') {
        this.pending ??= new Set();
        for (const p of paths) this.pending.add(p);
      }
      return;
    }
    this.enqueue(async () => {
      const present = await this.list();
      const set = new Set(present);
      for (const path of [...this.known.keys()]) {
        if (!set.has(path)) {
          this.known.delete(path);
          this.send({ type: 'delete', path });
        }
      }
      const check = paths ? paths.filter((p) => set.has(p)) : present;
      for (const path of present) if (!this.known.has(path) && !check.includes(path)) check.push(path);
      for (const path of check) {
        const data = await this.read(path);
        if (data === null || this.known.get(path) === data) continue;
        this.known.set(path, data);
        this.send({ type: 'file', path, data });
      }
    });
  }

  private enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch(() => undefined);
  }

  private send(msg: SyncToServer) {
    if (!this.closed && this.socket.readyState === 1) this.socket.send(JSON.stringify(msg));
  }

  // The project's files that this side owns.
  private async list(): Promise<string[]> {
    const all = await this.files.listFiles(this.project);
    return all.filter((p) => !isSyncSkipped(p) && !this.skipped.has(p));
  }

  private async read(path: string): Promise<string | null> {
    const data = await this.files.readBase64(this.project, path).catch(() => null);
    return data !== null && base64Bytes(data) <= MAX_SYNC_BYTES ? data : null;
  }

  // Flow-controlled: each batch waits for the server's 'init-ack' of the one
  // before, so at most one batch sits in the socket's send buffer (OkHttp
  // closes the socket once 16 MiB is queued; iOS fills up the same way).
  private async sendInit() {
    let files: { path: string; data: string }[] = [];
    let size = 0;
    for (const path of await this.list()) {
      const data = await this.read(path);
      if (data === null) continue;
      if (files.length && size + data.length > INIT_BATCH_BYTES) {
        const acked = new Promise<void>((resolve) => (this.initAck = resolve));
        this.send({ type: 'init', files, more: true });
        await acked;
        if (this.closed) return;
        files = [];
        size = 0;
      }
      this.known.set(path, data);
      files.push({ path, data });
      size += data.length + path.length;
    }
    this.send({ type: 'init', files });
  }

  private async apply(msg: SyncToApp) {
    switch (msg.type) {
      case 'ready': {
        this.ready = true;
        const pending = this.pending;
        this.pending = null;
        if (pending) this.changed(pending === 'all' ? undefined : [...pending]);
        this.hooks.onReady();
        return;
      }
      case 'init-ack':
        return;
      case 'skipped':
        this.known.delete(msg.path);
        this.skipped.add(msg.path);
        return;
      case 'ports':
        this.hooks.onPorts(msg.ports);
        return;
      // Both acknowledged, so the server only records what the phone really
      // has as agreed (and never takes a path it couldn't store as deleted).
      case 'file': {
        const { path, data } = msg;
        this.skipped.delete(path);
        let ok = true;
        if (this.known.get(path) !== data) {
          const isNew = !this.known.has(path);
          try {
            if (!this.ready && !isNew) await this.keepLocalEdit(path);
            await this.files.writeBase64(this.project, path, data);
            this.known.set(path, data);
            this.hooks.onFileChanged(path);
            if (isNew) this.hooks.onTreeChanged();
          } catch (e) {
            ok = false;
            this.disown(path, e);
          }
        }
        this.send({ type: 'ack', path, ok });
        return;
      }
      case 'delete': {
        const { path } = msg;
        const wasSkipped = this.skipped.delete(path);
        let ok = true;
        if (this.known.delete(path) || wasSkipped) {
          try {
            await this.files.removeIfPresent(this.project, path);
            this.hooks.onTreeChanged();
          } catch (e) {
            ok = false;
            this.disown(path, e);
          }
        }
        this.send({ type: 'ack', path, ok });
        return;
      }
    }
  }

  // Before 'ready' the container's reconcile result can arrive for a file the
  // user saved after the init read it (that edit is still pending): keep the
  // edit as a conflict copy, which is sent once 'ready' arrives.
  private async keepLocalEdit(path: string) {
    const local = await this.read(path);
    if (local === null || local === this.known.get(path)) return;
    await this.files.writeBase64(this.project, `${path}${CONFLICT_SUFFIX}`, local);
    this.pending = 'all';
    this.hooks.onTreeChanged();
  }

  // The phone couldn't apply a container change to `path`: the container owns
  // it from now on, so no stale copy here is ever sent back or taken as deleted.
  private disown(path: string, e: unknown) {
    this.known.delete(path);
    this.skipped.add(path);
    this.hooks.onSyncError?.(path, e instanceof Error ? e.message : String(e));
  }
}
