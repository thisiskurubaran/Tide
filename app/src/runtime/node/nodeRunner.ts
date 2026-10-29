import type { Envelope, RunnerMessage, SupervisorEvent, SupervisorRequest } from '@shared/protocol';

import type { Runner } from '../runner';

export interface NodeHost {
  start(script: string): void;
  channel: {
    addListener(event: 'message', callback: (msg: string) => void): void;
    send(msg: string): void;
  };
}

type Pong = Extract<SupervisorEvent, { type: 'pong' }>;
type Received = { type?: string; id?: string };

const RUNNER_TYPES = new Set(['stdout', 'stderr', 'exit', 'pty', 'debug', 'port']);

// Runner backed by the supervisor inside nodejs-mobile. Node can only start
// once per app process, so it starts on first use and stays up.
export function createNodeRunner(host: NodeHost, root: () => string): Runner & { ping(): Promise<Pong> } {
  let started = false;
  let ready = false;
  let queue: object[] = [];
  const listeners = new Map<string, (msg: RunnerMessage) => void>();
  let pongWaiters: ((p: Pong) => void)[] = [];
  // Numbering for the channel's Envelope, both directions.
  let sent = 0;
  let next = 0;
  const held = new Map<number, Received>();

  function transmit(msg: object) {
    host.channel.send(JSON.stringify({ n: sent++, m: msg } satisfies Envelope<object>));
  }

  function post(msg: object) {
    if (ready) transmit(msg);
    else queue.push(msg);
  }

  function onMessage(raw: string) {
    let env: Envelope<Received>;
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof env?.n !== 'number' || env.n < next) return;
    held.set(env.n, env.m);
    for (let msg = held.get(next); msg; msg = held.get(next)) {
      held.delete(next);
      next++;
      deliver(msg);
    }
  }

  function deliver(msg: Received) {
    if (msg.type === 'ready') {
      ready = true;
      transmit({ type: 'init', root: root() } satisfies SupervisorRequest);
      queue.forEach(transmit);
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
