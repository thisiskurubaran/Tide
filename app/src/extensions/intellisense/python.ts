// The Python side of IntelliSense: Jedi on a worker thread in the app's Python
// (tide_jedi.py), reached through the runtime's snippet() call. No React
// Native imports so tests can drive it with the host's python3.
import type { CompletionResult, HoverResult } from '../../features/editor/bridge';
import { createPythonTools, type Snippet } from '../pythonTools';
import type { Location } from '../types';
import type { FileEdits } from './client';

export const PY_FILE = /\.py$/i;

type Method = 'complete' | 'hover' | 'definition' | 'references' | 'rename';

// The editor gives up on completions and hover after 4 s; project-wide searches may take longer.
export const TIMEOUTS: Record<Method, number> = { complete: 3000, hover: 3000, definition: 10_000, references: 30_000, rename: 30_000 };
// Each snippet() call holds the runtime's queue (and on iOS, input to running scripts), so waits stay short.
const POLL_MS = 150;

type Reply<T> = { done: false } | { done: true; value: T };

export function createPyClient(snippet: Snippet, root: () => string, timeouts = TIMEOUTS) {
  const tools = createPythonTools(snippet);
  // Ids stay unique across JS reloads, which keep the same Python.
  const session = Math.random().toString(36).slice(2, 8);
  let next = 0;
  // The newest request of each kind; starting another cancels it, like typing on past a completion.
  const latest = new Map<Method, string>();
  const send = <T>(params: object) => tools.request<T>('jedi', params);
  const cancel = (id: string) => void send({ op: 'cancel', id }).catch(() => undefined);

  async function call<T>(method: Method, args: object): Promise<T | null> {
    const id = `${session}-${++next}`;
    const previous = latest.get(method);
    if (previous) cancel(previous);
    latest.set(method, id);
    const deadline = Date.now() + timeouts[method];
    try {
      let reply = await send<Reply<T>>({ op: 'call', id, method, args, wait: POLL_MS });
      while (!reply.done) {
        // A newer request already cancelled this one.
        if (latest.get(method) !== id) return null;
        if (Date.now() > deadline) {
          cancel(id);
          throw new Error('Python IntelliSense took too long');
        }
        reply = await send<Reply<T>>({ op: 'poll', id, wait: POLL_MS });
      }
      return reply.value;
    } catch (e) {
      if (latest.get(method) !== id) return null;
      // Errors come back as "RuntimeError: ValueError: <message>"; the message is what matters.
      throw new Error((e instanceof Error ? e.message : String(e)).replace(/^(\w+(Error|Exception): )+/, ''));
    } finally {
      if (latest.get(method) === id) latest.delete(method);
    }
  }

  const doc = (project: string, path: string, content: string, offset: number) => ({ root: root(), project, path, content, offset });

  return {
    completions: (project: string, path: string, content: string, offset: number) =>
      call<CompletionResult>('complete', doc(project, path, content, offset)),
    hover: (project: string, path: string, content: string, offset: number) => call<HoverResult>('hover', doc(project, path, content, offset)),
    async definition(project: string, path: string, content: string, offset: number) {
      return (await call<Location[]>('definition', doc(project, path, content, offset))) ?? [];
    },
    async references(project: string, path: string, content: string, offset: number) {
      return (await call<Location[]>('references', doc(project, path, content, offset))) ?? [];
    },
    async rename(project: string, path: string, content: string, offset: number, newName: string) {
      return (await call<FileEdits[]>('rename', { ...doc(project, path, content, offset), newName })) ?? [];
    },
    stop() {
      for (const id of latest.values()) cancel(id);
      latest.clear();
    },
  };
}
