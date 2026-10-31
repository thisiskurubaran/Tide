import type { RunnerMessage, RunRequest } from '@shared/protocol';

import type { Runner } from '../runner';
import type { FileMap, FromRuntime, ToRuntime, WasmRuntime } from './protocol';

// Files the run can see, and writing back what it changed.
export interface WasmFiles {
  read(project: string): Promise<FileMap>;
  apply(project: string, changed: FileMap, removed: string[]): Promise<void>;
}

// The hidden web view that runs the interpreters (WasmHost).
export interface WasmPage {
  // Mounts the page if needed; resolves once it has said it's ready.
  ready(): Promise<void>;
  send(msg: ToRuntime): void;
  // Reloads the page, the only way to stop WebAssembly mid-run.
  restart(): void;
}

// "projects/<name>/<rest>" -> name and the path inside the project.
const split = (path: string) => {
  const parts = path.split('/');
  return { project: parts[1], rest: parts.slice(2).join('/') };
};

// Runs Ruby and PHP. The project's files go to the page with the run (the
// interpreters have their own virtual disk), and what the program wrote or
// deleted comes back and is applied to the project when it exits.
export class WasmRunner implements Runner {
  private runs = new Map<string, { project: string; on: (m: RunnerMessage) => void }>();
  private urls: { ruby: string; php: string } | null = null;

  constructor(
    private page: WasmPage,
    private files: WasmFiles,
    private resolveUrls: () => Promise<{ ruby: string; php: string }>,
  ) {}

  run(req: RunRequest, on: (m: RunnerMessage) => void) {
    const { project, rest: entry } = split(req.entry);
    const cwd = split(req.cwd).rest;
    this.runs.set(req.id, { project, on });
    (async () => {
      await this.page.ready();
      this.urls ??= await this.resolveUrls();
      this.page.send({ type: 'init', ...this.urls });
      const files = await this.files.read(project);
      this.page.send({ type: 'run', id: req.id, runtime: req.runtime as WasmRuntime, entry, cwd, args: req.args, env: req.env ?? {}, files, stdin: '' });
    })().catch((e) => {
      on({ type: 'stderr', id: req.id, data: `${e instanceof Error ? e.message : String(e)}\n` });
      this.finish(req.id, 1);
    });
  }

  send(msg: { type: string; id: string }) {
    // Interpreters can't read the terminal; input goes nowhere. Kill reloads the page.
    if (msg.type !== 'kill' || !this.runs.has(msg.id)) return;
    this.page.restart();
    for (const id of [...this.runs.keys()]) this.finish(id, 130, 'SIGINT');
  }

  // Messages from the page.
  receive(msg: FromRuntime) {
    if (msg.type === 'ready') return;
    const run = this.runs.get(msg.id);
    if (!run) return;
    if (msg.type === 'status') run.on({ type: 'stderr', id: msg.id, data: `\x1b[90m${msg.text}\x1b[0m\r` });
    else if (msg.type === 'stdout' || msg.type === 'stderr') run.on({ type: msg.type, id: msg.id, data: msg.data });
    else if (msg.type === 'exit') {
      this.files
        .apply(run.project, msg.changed, msg.removed)
        .catch((e) => run.on({ type: 'stderr', id: msg.id, data: `Couldn't save the files the program wrote: ${e instanceof Error ? e.message : String(e)}\n` }))
        .finally(() => this.finish(msg.id, msg.code));
    }
  }

  private finish(id: string, code: number, signal?: string) {
    const run = this.runs.get(id);
    if (!run) return;
    this.runs.delete(id);
    run.on({ type: 'exit', id, code, ...(signal ? { signal } : {}) });
  }
}
