// Sends Ruff requests to the hidden web view RuffHost mounts, starting it the
// first time a Python file is linted or formatted.
import { createStore } from 'zustand';

import type { RuffDiagnostic, RuffSettings } from './ruff';
import type { FromRuff, RuffMethod, ToRuff } from './ruffProtocol';

// The first request also loads and compiles the 10 MB module.
const TIMEOUT_MS = 30_000;

export const ruffHostStore = createStore<{ wanted: boolean; generation: number }>(() => ({ wanted: false, generation: 0 }));

let post: ((msg: ToRuff) => void) | null = null;
let ready = false;
let readyWaiters: (() => void)[] = [];
let nextId = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();

function whenReady(): Promise<void> {
  if (ready) return Promise.resolve();
  ruffHostStore.setState({ wanted: true });
  return new Promise((resolve) => readyWaiters.push(resolve));
}

function request<T>(method: RuffMethod, content: string, settings: RuffSettings): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    // Counts from the call, so a page that never loads fails too.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Ruff took too long to answer.'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    whenReady().then(() => {
      if (pending.has(id)) post?.({ type: 'request', id, method, content, settings });
    });
  });
}

export const ruff = {
  check: (content: string, settings: RuffSettings) => request<RuffDiagnostic[]>('check', content, settings),
  format: (content: string, settings: RuffSettings) => request<string>('format', content, settings),
};

// For RuffHost.
export const ruffBridge = {
  attach(send: ((msg: ToRuff) => void) | null) {
    post = send;
  },
  // The page loaded: hand it the module's URL and send what was waiting.
  loaded(wasm: string) {
    post?.({ type: 'init', wasm });
    ready = true;
    readyWaiters.forEach((w) => w());
    readyWaiters = [];
  },
  receive(msg: FromRuff) {
    if (msg.type !== 'reply') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error !== undefined) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  },
  // The web view's process went away: fail what was in flight and load it again.
  crashed() {
    ready = false;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Ruff stopped; try again.'));
    }
    pending.clear();
    ruffHostStore.setState((s) => ({ generation: s.generation + 1 }));
  },
};
