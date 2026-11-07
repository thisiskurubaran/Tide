// Waits for a persisted zustand store to load its saved state.
export type Persisted = { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } };

// zustand's persist never reports hydration finished when loading fails
// (storage throws, a migration throws), so waiting is capped: a store that
// hasn't loaded by then starts from its defaults instead of keeping the app on
// the splash screen forever.
const HYDRATION_TIMEOUT_MS = 8000;

export const hydrated = (store: Persisted, timeoutMs = HYDRATION_TIMEOUT_MS) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      console.warn('A saved state file did not load in time; starting with defaults for it');
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
