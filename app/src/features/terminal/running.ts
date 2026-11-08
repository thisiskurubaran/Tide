// What is running right now in the app's terminals: one entry per local shell
// with a command in progress, and per remote (or SSH) shell that looks busy.
// It is the single place the keep-awake controller (keepAwake.ts) reads; dev
// servers, tasks and test runs all run in a terminal, so they show up here.

export interface RunningRegistry {
  // Marks `key` as running or not. Unknown keys being turned off are ignored.
  set(key: string, on: boolean): void;
  isRunning(): boolean;
  // Called after every change in whether anything runs.
  subscribe(fn: (running: boolean) => void): () => void;
}

export function createRunningRegistry(): RunningRegistry {
  const active = new Set<string>();
  const listeners = new Set<(running: boolean) => void>();
  return {
    set(key, on) {
      const before = active.size > 0;
      if (on) active.add(key);
      else active.delete(key);
      const now = active.size > 0;
      if (now === before) return;
      for (const fn of [...listeners]) {
        try {
          fn(now);
        } catch (e) {
          console.warn('A running listener failed', e);
        }
      }
    },
    isRunning: () => active.size > 0,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const running = createRunningRegistry();

let counter = 0;
export const runningKey = (kind: string) => `${kind}-${++counter}`;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g;
// A shell prompt at the end of the output: "user@host:~/app$ ", "root# ", "% ".
const PROMPT = /[$#%❯›] $/;
// What RemotePty and the SSH client print when their connection ends.
const CLOSED = /Remote shell closed|Connection closed\./;

// A remote bash does its own line editing, so the app can't see when a
// command starts or ends. It counts as busy from an Enter until the output
// ends with something that looks like a prompt again (or the shell closes).
export function createRemoteBusyTracker(onChange: (busy: boolean) => void) {
  let busy = false;
  let tail = '';
  const set = (next: boolean) => {
    if (next === busy) return;
    busy = next;
    onChange(next);
  };
  return {
    get busy() {
      return busy;
    },
    input(data: string) {
      if (!data.includes('\r') && !data.includes('\n')) return;
      tail = '';
      set(true);
    },
    output(data: string) {
      if (!busy) return;
      tail = (tail + data).slice(-400);
      const plain = tail.replace(ANSI, '');
      if (CLOSED.test(plain)) return set(false);
      const lastLine = plain.split('\n').pop()!;
      const shown = lastLine.slice(lastLine.lastIndexOf('\r') + 1);
      if (shown.trim() && PROMPT.test(shown)) set(false);
    },
    end() {
      tail = '';
      set(false);
    },
  };
}
