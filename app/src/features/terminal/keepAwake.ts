// Keeps the screen on while something runs in a terminal (a program, task,
// test run or dev server, local or remote), so a long build or a server
// isn't cut off by auto-lock. Uses a tag of its own, so it never releases a
// keep-awake something else asked for. Released as soon as nothing runs,
// the setting is turned off, or the app goes to the background.
import { running as defaultRegistry, RunningRegistry } from './running';

export const KEEP_AWAKE_TAG = 'tide-running';
// Quick commands (ls, cd) finish well before this; only longer runs keep the
// screen on, so they don't toggle it on every command. Auto-lock is 30 s at least.
export const ACTIVATE_DELAY_MS = 1500;

export interface KeepAwakeNative {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void> | void;
}

export interface KeepAwakeDeps {
  native: KeepAwakeNative;
  registry: RunningRegistry;
  // The setting; `subscribeEnabled` tells the controller when it may have changed.
  enabled(): boolean;
  subscribeEnabled(fn: () => void): () => void;
  // Whether the app is in the foreground, and when that changes.
  foreground(): boolean;
  subscribeForeground(fn: () => void): () => void;
  delayMs?: number;
}

export interface KeepAwakeController {
  // Whether the screen is being kept on (or is being asked to be).
  readonly active: boolean;
  // Re-reads everything; the controller also does this on every change it hears about.
  update(): void;
  // Releases it and stops listening.
  dispose(): void;
}

export function createKeepAwake(deps: KeepAwakeDeps): KeepAwakeController {
  const { native, registry, delayMs = ACTIVATE_DELAY_MS } = deps;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const wanted = () => {
    if (disposed) return false;
    try {
      return registry.isRunning() && deps.enabled() && deps.foreground();
    } catch {
      return false;
    }
  };

  const release = () => {
    if (!active) return;
    active = false;
    try {
      Promise.resolve(native.deactivate(KEEP_AWAKE_TAG)).catch((e) => console.warn('Could not let the screen sleep again', e));
    } catch (e) {
      console.warn('Could not let the screen sleep again', e);
    }
  };

  const acquire = () => {
    timer = null;
    if (active || !wanted()) return;
    active = true;
    let request: Promise<void>;
    try {
      request = native.activate(KEEP_AWAKE_TAG);
    } catch (e) {
      request = Promise.reject(e);
    }
    request.then(
      // Everything may have ended while the request was on its way.
      () => {
        if (!wanted()) {
          active = true;
          release();
        }
      },
      (e) => {
        active = false;
        console.warn('Could not keep the screen awake', e);
      },
    );
  };

  const update = () => {
    if (wanted()) {
      if (!active && timer === null) timer = setTimeout(acquire, delayMs);
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    release();
  };

  const unsubscribe = [registry.subscribe(update), deps.subscribeEnabled(update), deps.subscribeForeground(update)];

  return {
    get active() {
      return active;
    },
    update,
    dispose() {
      disposed = true;
      for (const u of unsubscribe) u();
      update();
    },
  };
}

// expo-keep-awake, if this build has it. Required inside try so a build
// without the module still bundles (Metro treats it as optional) and simply
// never keeps the screen on.
function loadNative(): KeepAwakeNative | null {
  try {
    const mod = require('expo-keep-awake') as { activateKeepAwakeAsync(tag?: string): Promise<void>; deactivateKeepAwake(tag?: string): Promise<void> | void };
    return { activate: (tag) => mod.activateKeepAwakeAsync(tag), deactivate: (tag) => mod.deactivateKeepAwake(tag) };
  } catch {
    return null;
  }
}

let started: KeepAwakeController | null = null;

// Wires the controller to the app: the running registry, the "Keep screen
// awake while running" setting and the app's foreground state. Safe to call
// more than once; the first call starts it.
export function startKeepAwake(): KeepAwakeController | null {
  if (started) return started;
  const native = loadNative();
  if (!native) return null;
  // Loaded here, not at the top, so the pure controller above can be tested alone.
  const { AppState } = require('react-native') as typeof import('react-native');
  const { settingsStore } = require('../../state') as typeof import('../../state');
  started = createKeepAwake({
    native,
    registry: defaultRegistry,
    enabled: () => settingsStore.getState().keepAwake !== false,
    subscribeEnabled: (fn) => settingsStore.subscribe((s, prev) => s.keepAwake !== prev.keepAwake && fn()),
    foreground: () => AppState.currentState !== 'background',
    subscribeForeground: (fn) => {
      const sub = AppState.addEventListener('change', () => fn());
      return () => sub.remove();
    },
  });
  return started;
}

// For tests.
export function stopKeepAwake() {
  started?.dispose();
  started = null;
}
