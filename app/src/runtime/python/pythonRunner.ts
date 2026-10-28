import type { RunnerMessage } from '@shared/protocol';

import type { Runner } from '../runner';

type Output = { id: string; kind: 'stdout' | 'stderr'; data: string };
type Exit = { id: string; code: number; killed: boolean };

export interface PythonHost {
  run(id: string, entry: string, cwd: string, args: string[], extraPaths: string[], purgeRoot: string): Promise<void>;
  write(id: string, data: string): Promise<void>;
  kill(id: string): Promise<void>;
  addListener(event: 'onOutput', listener: (e: Output) => void): unknown;
  addListener(event: 'onExit', listener: (e: Exit) => void): unknown;
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

// Runner backed by the python-runtime module (Chaquopy on Android, embedded
// CPython on iOS). Runs share one interpreter; each gets its own thread.
export function createPythonRunner(host: PythonHost, root: () => string): Runner {
  const listeners = new Map<string, (msg: RunnerMessage) => void>();
  let subscribed = false;

  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    host.addListener('onOutput', (e: Output) => listeners.get(e.id)?.({ type: e.kind, id: e.id, data: e.data }));
    host.addListener('onExit', (e: Exit) => {
      const listener = listeners.get(e.id);
      listeners.delete(e.id);
      listener?.(e.killed ? { type: 'exit', id: e.id, code: 130, signal: 'SIGINT' } : { type: 'exit', id: e.id, code: e.code });
    });
  }

  return {
    run(req, onMessage) {
      subscribe();
      listeners.set(req.id, onMessage);
      const base = root();
      // "projects/<name>/..." -> pure-Python packages from pip live in <project>/.pylibs.
      const project = req.cwd.split('/').slice(0, 2).join('/');
      host
        .run(req.id, join(base, req.entry), join(base, req.cwd), req.args, [join(base, project, '.pylibs')], base)
        .catch((e: Error) => {
          listeners.delete(req.id);
          onMessage({ type: 'stderr', id: req.id, data: `${e.message}\n` });
          onMessage({ type: 'exit', id: req.id, code: 1 });
        });
    },
    send(msg) {
      if (msg.type === 'stdin') host.write(msg.id, msg.data).catch(() => undefined);
      else host.kill(msg.id).catch(() => undefined);
    },
  };
}
