import type { Runner } from '../runtime/runner';

// A long-lived helper in the Node supervisor (see nodejs-project/service.js),
// started on first use and restarted on the next request if it dies.
export interface Service {
  request<T>(method: string, params: object, timeoutMs?: number): Promise<T>;
  notify(method: string, params: object): void;
  onNotification(listener: (method: string, params: unknown) => void): () => void;
  stop(): void;
}

interface ServiceOptions {
  // A built-in entry, e.g. 'tide:format'.
  entry: string;
  maxMemoryMb?: number;
  // Called when a request had to start the service; e.g. to resend open files.
  onStart?(): void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

let runs = 0;

export function createService(runner: Runner, { entry, maxMemoryMb, onStart }: ServiceOptions): Service {
  let id: string | null = null;
  let next = 0;
  // Each request remembers the run it went to, so a run that dies only fails its own.
  const pending = new Map<number, { run: string; resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<(method: string, params: unknown) => void>();

  function fail(run: string, error: Error) {
    for (const [reqId, p] of pending) {
      if (p.run !== run) continue;
      clearTimeout(p.timer);
      pending.delete(reqId);
      p.reject(error);
    }
  }

  function receive(line: string) {
    let msg: { id?: number; result?: unknown; error?: string; method?: string; params?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error !== undefined) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg.method, msg.params);
    }
  }

  function start() {
    if (id) return id;
    const runId = `svc-${entry.replace(/\W/g, '')}-${++runs}`;
    id = runId;
    // Per run, so a stopped run's last output can't mix with the next one's.
    let buffer = '';
    let stderr = '';
    runner.run(
      { type: 'run', id: runId, runtime: 'node', entry, cwd: '.', args: [], limits: maxMemoryMb ? { maxMemoryMb } : undefined },
      (msg) => {
        if (msg.type === 'stdout') {
          buffer += msg.data;
          let nl = buffer.indexOf('\n');
          while (nl !== -1) {
            receive(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf('\n');
          }
        } else if (msg.type === 'stderr') {
          stderr = (stderr + msg.data).slice(-2000);
        } else if (msg.type === 'exit') {
          if (id === runId) id = null;
          fail(runId, new Error(`${entry} stopped${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`));
        }
      },
    );
    onStart?.();
    return runId;
  }

  function write(msg: object) {
    const runId = start();
    runner.send({ type: 'stdin', id: runId, data: `${JSON.stringify(msg)}\n` });
  }

  return {
    request<T>(method: string, params: object, timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise<T>((resolve, reject) => {
        const reqId = ++next;
        const timer = setTimeout(() => {
          pending.delete(reqId);
          reject(new Error(`${entry} did not answer ${method} in time`));
        }, timeoutMs);
        const run = start();
        pending.set(reqId, { run, resolve: resolve as (v: unknown) => void, reject, timer });
        write({ id: reqId, method, params });
      });
    },
    notify(method, params) {
      write({ method, params });
    },
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      if (!id) return;
      const run = id;
      id = null;
      runner.send({ type: 'kill', id: run });
      fail(run, new Error(`${entry} stopped`));
    },
  };
}
