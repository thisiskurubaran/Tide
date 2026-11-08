import type { PersistStorage } from 'zustand/middleware';

import { onStateFileReadable } from './storage';

// Waits for a persisted zustand store to load its saved state.
export type Persisted = {
  persist: {
    hasHydrated(): boolean;
    onFinishHydration(fn: () => void): () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setOptions(options: { storage?: PersistStorage<any> }): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getOptions?(): { name?: string; storage?: PersistStorage<any> };
    rehydrate?(): Promise<void> | void;
  };
};

// Storage reads give up on their own (see storage.ts READ_TIMEOUT_MS), but
// zustand's persist never reports hydration finished when loading fails some
// other way (a migration throws), so waiting is capped: a store that hasn't
// loaded by then starts from its defaults instead of keeping the app on the
// splash screen forever.
const HYDRATION_TIMEOUT_MS = 8000;

// Drops writes. persist writes on every change whether or not it has loaded,
// so a store that didn't load is switched to this; otherwise its defaults
// would replace the saved file it failed to load.
const discard: PersistStorage<unknown> = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

// Each store's wait, so a store that timed out isn't waited for again.
const outcomes = new WeakMap<Persisted, Promise<void>>();
// The storage a store had before it was switched to `discard`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const swapped = new WeakMap<Persisted, PersistStorage<any>>();
const watched = new WeakSet<Persisted>();

// A state file whose read timed out may be read after all (storage.ts). The
// store then loads it again: its saved state is merged in (by the store's
// `merge`) and saving is allowed again, instead of dropping every write for
// the rest of the launch.
const reloadWhenReadable = (store: Persisted) => {
  const name = store.persist.getOptions?.().name;
  if (watched.has(store) || !name || !store.persist.rehydrate) return;
  watched.add(store);
  onStateFileReadable((file) => {
    if (file !== name) return;
    const original = swapped.get(store);
    if (original) {
      swapped.delete(store);
      store.persist.setOptions({ storage: original });
    }
    Promise.resolve(store.persist.rehydrate?.()).catch((e) => console.warn(`Could not reload ${file}`, e));
  });
};

export const hydrated = (store: Persisted, timeoutMs = HYDRATION_TIMEOUT_MS): Promise<void> => {
  reloadWhenReadable(store);
  const known = outcomes.get(store);
  if (known) return known;
  const outcome = wait(store, timeoutMs);
  outcomes.set(store, outcome);
  return outcome;
};

const wait = (store: Persisted, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      if (!store.persist.hasHydrated()) {
        const original = store.persist.getOptions?.().storage;
        if (original && original !== discard) swapped.set(store, original);
        store.persist.setOptions({ storage: discard });
        console.warn('A saved state file did not load in time; starting with defaults for it, without saving over it');
      }
      resolve();
    }, timeoutMs);
    const unsubscribe = store.persist.onFinishHydration(() => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
    // It may have finished between the check and subscribing.
    if (store.persist.hasHydrated()) {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });

// Resolves once every start-up task has finished, whether it loaded or failed.
// Each failure is reported on its own and never cuts the wait short, so one
// that fails early (the project list can't be read) doesn't lift the splash
// before the rest have loaded. Never rejects.
export const allLoaded = (tasks: Promise<unknown>[], onError: (e: unknown) => void = (e) => console.warn('Start-up loading failed', e)) =>
  Promise.all(tasks.map((p) => p.catch(onError))).then(() => undefined);
