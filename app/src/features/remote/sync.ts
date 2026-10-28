import type { SyncToApp, SyncToServer } from '@shared/protocol';

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
}

// Same limit as the server's watcher: bigger files aren't synced either way.
export const MAX_SYNC_BYTES = 2 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_SYNC_BYTES / 3) * 4;

// Keeps a project's files in step with its container. `known` holds the last
// content each side agreed on, so a change applied from one side is not sent
// straight back to it.
export class RemoteSync {
  private known = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private ready = false;
  private closed = false;

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
      this.enqueue(() => this.apply(msg));
    };
  }

  close() {
    this.closed = true;
    this.socket.close();
  }

  // Called after the app saved, created or deleted files. Diffing against
  // `known` catches renames and deletes made from the file tree too.
  changed(paths?: string[]) {
    if (!this.ready) return;
    this.enqueue(async () => {
      const present = await this.files.listFiles(this.project);
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

  private async read(path: string): Promise<string | null> {
    const data = await this.files.readBase64(this.project, path).catch(() => null);
    return data !== null && data.length <= MAX_BASE64 ? data : null;
  }

  private async sendInit() {
    const files: { path: string; data: string }[] = [];
    for (const path of await this.files.listFiles(this.project)) {
      const data = await this.read(path);
      if (data === null) continue;
      this.known.set(path, data);
      files.push({ path, data });
    }
    this.send({ type: 'init', files });
  }

  private async apply(msg: SyncToApp) {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.hooks.onReady();
        return;
      case 'ports':
        this.hooks.onPorts(msg.ports);
        return;
      case 'file': {
        if (this.known.get(msg.path) === msg.data) return;
        const isNew = !this.known.has(msg.path);
        this.known.set(msg.path, msg.data);
        await this.files.writeBase64(this.project, msg.path, msg.data);
        this.hooks.onFileChanged(msg.path);
        if (isNew) this.hooks.onTreeChanged();
        return;
      }
      case 'delete':
        if (!this.known.delete(msg.path)) return;
        await this.files.removeIfPresent(this.project, msg.path);
        this.hooks.onTreeChanged();
        return;
    }
  }
}
