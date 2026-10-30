// Deploying on its own: after a save (once saving goes quiet) or after each
// commit, per the project's "auto" setting in tide.json, plus the status the
// project screen shows and a short history per project.
import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { DeployConfig } from './providers';

export type AutoDeploy = 'off' | 'save' | 'commit';
export type Trigger = 'manual' | 'save' | 'commit';

export interface DeployRecord {
  at: number;
  provider: string;
  trigger: Trigger;
  ok: boolean;
  url?: string;
  error?: string;
}

export interface DeployStatus {
  state: 'deploying' | 'done' | 'failed';
  message: string;
  url?: string;
}

const HISTORY = 20;
// Saves come in bursts while typing; deploy once they stop.
export const SAVE_QUIET_MS = 15_000;

interface DeployState {
  status: Record<string, DeployStatus | undefined>;
  history: Record<string, DeployRecord[]>;
  setStatus(project: string, status: DeployStatus | undefined): void;
  record(project: string, entry: DeployRecord): void;
}

export function createDeployStore(storage: StateStorage) {
  return createStore<DeployState>()(
    persist(
      (set) => ({
        status: {},
        history: {},
        setStatus: (project, status) => set((s) => ({ status: { ...s.status, [project]: status } })),
        record: (project, entry) => set((s) => ({ history: { ...s.history, [project]: [entry, ...(s.history[project] ?? [])].slice(0, HISTORY) } })),
      }),
      { name: 'deploys', version: 1, storage: createJSONStorage(() => storage), partialize: (s) => ({ history: s.history }) },
    ),
  );
}

export type DeployStore = ReturnType<typeof createDeployStore>;

interface Deps {
  store: DeployStore;
  readConfig(project: string): Promise<(DeployConfig & { auto?: AutoDeploy }) | null>;
  deploy(project: string, config: DeployConfig, progress: (m: string) => void): Promise<{ url: string }>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

// Runs deploys one at a time per project; a trigger during a deploy queues one more.
export function createAutoDeployer(deps: Deps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const running = new Map<string, Promise<void>>();
  const again = new Map<string, Trigger>();
  const timers = new Map<string, unknown>();

  async function run(project: string, trigger: Trigger, config?: DeployConfig): Promise<void> {
    if (running.has(project)) {
      again.set(project, trigger);
      return running.get(project);
    }
    const job = (async () => {
      const cfg = config ?? (await deps.readConfig(project));
      if (!cfg) return;
      const { store } = deps;
      store.getState().setStatus(project, { state: 'deploying', message: 'Deploying…' });
      try {
        const { url } = await deps.deploy(project, cfg, (message) => store.getState().setStatus(project, { state: 'deploying', message }));
        store.getState().setStatus(project, { state: 'done', message: 'Deployed', url });
        store.getState().record(project, { at: now(), provider: cfg.provider, trigger, ok: true, url });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        store.getState().setStatus(project, { state: 'failed', message: error });
        store.getState().record(project, { at: now(), provider: cfg.provider, trigger, ok: false, error });
      }
    })();
    running.set(project, job);
    try {
      await job;
    } finally {
      running.delete(project);
      const next = again.get(project);
      again.delete(project);
      if (next) await run(project, next);
    }
  }

  return {
    run,
    async onSave(project: string) {
      const cfg = await deps.readConfig(project);
      if (cfg?.auto !== 'save') return;
      if (timers.has(project)) clearTimer(timers.get(project));
      timers.set(
        project,
        setTimer(() => {
          timers.delete(project);
          run(project, 'save');
        }, SAVE_QUIET_MS),
      );
    },
    async onCommit(project: string) {
      const cfg = await deps.readConfig(project);
      if (cfg?.auto === 'commit') await run(project, 'commit');
    },
  };
}

export const useDeployStatus = (store: DeployStore, project: string) => useStore(store, (s) => s.status[project]);
