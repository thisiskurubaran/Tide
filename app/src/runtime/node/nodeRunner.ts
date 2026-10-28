import type { RunnerMessage, SupervisorEvent, SupervisorRequest } from '@shared/protocol';

import type { Runner } from '../runner';

export interface NodeHost {
  start(script: string): void;
  channel: {
    addListener(event: 'message', callback: (msg: string) => void): void;
    send(msg: string): void;
  };
}

type Pong = Extract<SupervisorEvent, { type: 'pong' }>;

const RUNNER_TYPES = new Set(['stdout', 'stderr', 'exit', 'pty']);

// Runner backed by the supervisor inside nodejs-mobile. Node can only start
// once per app process, so it starts on first use and stays up.
export function createNodeRunner(host: NodeHost, root: () => string): Runner & { ping(): Promise<Pong> } {
  let started = false;
  let ready = false;
  let queue: string[] = [];
  const listeners = new Map<string, (msg: RunnerMessage) => void>();
  let pongWaiters: ((p: Pong) => void)[] = [];

  function post(msg: object) {
    const raw = JSON.stringify(msg);
    if (ready) host.channel.send(raw);
    else queue.push(raw);
  }

  function onMessage(raw: string) {
    let msg: { type?: string; id?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      ready = true;
      host.channel.send(JSON.stringify({ type: 'init', root: root() } satisfies SupervisorRequest));
      queue.forEach((m) => host.channel.send(m));
      queue = [];
      return;
    }
    if (msg.type === 'pong') {
      pongWaiters.forEach((w) => w(msg as Pong));
      pongWaiters = [];
      return;
    }
    if (msg.type && RUNNER_TYPES.has(msg.type) && msg.id) {
      const listener = listeners.get(msg.id);
      listener?.(msg as RunnerMessage);
      if (msg.type === 'exit') listeners.delete(msg.id);
    }
  }

  function ensureStarted() {
    if (started) return;
    started = true;
    host.channel.addListener('message', onMessage);
    host.start('main.js');
  }

  return {
    run(req, onRunnerMessage) {
      ensureStarted();
      listeners.set(req.id, onRunnerMessage);
      post(req);
    },
    send(msg) {
      ensureStarted();
      post(msg);
    },
    ping() {
      ensureStarted();
      return new Promise<Pong>((resolve) => {
        pongWaiters.push(resolve);
        post({ type: 'ping' } satisfies SupervisorRequest);
      });
    },
  };
}
