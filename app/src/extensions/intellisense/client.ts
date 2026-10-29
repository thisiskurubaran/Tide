// The TypeScript service client, without React Native imports so tests can use it.
import type { CompletionResult, HoverResult } from '../../features/editor/bridge';
import { joinPath } from '../../features/files/fs';
import { PROJECTS_DIR } from '../../features/files/workspace';
import type { Runner } from '../../runtime/runner';
import { createService } from '../services';
import type { Location } from '../types';
import type { LintMessage } from '../formatLint/lintMessages';

export const TS_FILE = /\.(m?[jt]sx?|c[jt]s)$/i;

export interface FileEdits {
  path: string;
  edits: { from: number; to: number; insert: string }[];
}

// The language service holds ~100 MB of type information for lib.dom alone.
const MAX_MEMORY_MB = 512;

export function createTsClient(runner: Runner) {
  // What the service was last told each open file contains, so only changes are sent.
  const sent = new Map<string, string>();
  const service = createService(runner, { entry: 'tide:intellisense', maxMemoryMb: MAX_MEMORY_MB, onStart: () => sent.clear() });
  const key = (project: string, path: string) => joinPath(PROJECTS_DIR, project, path);

  function sync(project: string, path: string, content: string) {
    const k = key(project, path);
    if (sent.get(k) === content) return;
    sent.set(k, content);
    service.notify('open', { path: k, content });
  }

  return {
    sync,
    async completions(project: string, path: string, content: string, offset: number) {
      sync(project, path, content);
      return service.request<CompletionResult>('completions', { path: key(project, path), offset });
    },
    async hover(project: string, path: string, content: string, offset: number) {
      sync(project, path, content);
      return service.request<HoverResult | null>('hover', { path: key(project, path), offset });
    },
    async definition(project: string, path: string, content: string, offset: number) {
      sync(project, path, content);
      return service.request<Location[]>('definition', { path: key(project, path), offset });
    },
    async references(project: string, path: string, content: string, offset: number) {
      sync(project, path, content);
      return service.request<Location[]>('references', { path: key(project, path), offset });
    },
    async rename(project: string, path: string, content: string, offset: number, newName: string) {
      sync(project, path, content);
      return service.request<FileEdits[]>('rename', { path: key(project, path), offset, newName });
    },
    async diagnostics(project: string, path: string, content: string) {
      sync(project, path, content);
      // The first check builds the whole program, which takes a while on a phone.
      return service.request<LintMessage[]>('diagnostics', { path: key(project, path) }, 60_000);
    },
    stop() {
      service.stop();
      sent.clear();
    },
  };
}

// Applies edits computed for `text`, last first so earlier offsets stay valid.
export function applyEdits(text: string, edits: FileEdits['edits']): string {
  return [...edits].sort((a, b) => b.from - a.from).reduce((t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to), text);
}
