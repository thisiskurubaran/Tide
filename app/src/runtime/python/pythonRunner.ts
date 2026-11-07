import type { DebugEvent, RunnerMessage } from '@shared/protocol';

import type { Runner } from '../runner';

// 'debug' carries a JSON DebugEvent from tide_runner's debugger; 'port' a
// JSON {port, open} when the script starts listening.
type Output = { id: string; kind: 'stdout' | 'stderr' | 'debug' | 'port'; data: string };

// Debugger commands share the stdin channel (see tide_runner.feed), so the
// native modules need no new function.
export const DEBUG_PREFIX = '\u0000tide-debug:';
export const DEBUG_ARG = '--tide-debug';
// The run's environment variables, as JSON; tide_runner sets os.environ for the run.
export const ENV_ARG = '--tide-env';
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
    host.addListener('onOutput', (e: Output) => {
      const listener = listeners.get(e.id);
      if (!listener) return;
      if (e.kind === 'debug') listener({ type: 'debug', id: e.id, event: JSON.parse(e.data) as DebugEvent });
      else if (e.kind === 'port') listener({ type: 'port', id: e.id, ...(JSON.parse(e.data) as { port: number; open: boolean }) });
      else listener({ type: e.kind, id: e.id, data: e.data });
    });
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
      const debug = req.debug ? [DEBUG_ARG, JSON.stringify(req.debug)] : [];
      const env = req.env && Object.keys(req.env).length ? [ENV_ARG, JSON.stringify(req.env)] : [];
      const args = [...env, ...debug, ...req.args];
      host
        .run(req.id, join(base, req.entry), join(base, req.cwd), args, [join(base, project, '.pylibs')], base)
        .catch((e: Error) => {
          listeners.delete(req.id);
          onMessage({ type: 'stderr', id: req.id, data: `${e.message}\n` });
          onMessage({ type: 'exit', id: req.id, code: 1 });
        });
    },
    send(msg) {
      if (msg.type === 'stdin') host.write(msg.id, msg.data).catch(() => undefined);
      else if (msg.type === 'debug') host.write(msg.id, DEBUG_PREFIX + JSON.stringify(msg.command)).catch(() => undefined);
      else host.kill(msg.id).catch(() => undefined);
    },
  };
}
