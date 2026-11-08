import { createMemoryFs } from '../files/memoryFs';
import { createSettingsStore } from '../../state/settings';
import { createFsStorage } from '../../state/storage';
import { ACTIVATE_DELAY_MS, createKeepAwake, KEEP_AWAKE_TAG, KeepAwakeNative } from './keepAwake';
import { createRunningRegistry } from './running';

const mockKeepAwake = { activateKeepAwakeAsync: jest.fn(async (_tag?: string) => undefined), deactivateKeepAwake: jest.fn(async (_tag?: string) => undefined) };
jest.mock('expo-keep-awake', () => mockKeepAwake, { virtual: true });

const mockAppState = { currentState: 'active' as string, listeners: new Set<() => void>() };
jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppState.currentState;
    },
    addEventListener: (_: string, fn: () => void) => {
      mockAppState.listeners.add(fn);
      return { remove: () => mockAppState.listeners.delete(fn) };
    },
  },
}));

const mockSettings = createSettingsStore(createFsStorage(createMemoryFs()));
jest.mock('../../state', () => ({ settingsStore: mockSettings }));

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(native?: Partial<KeepAwakeNative>) {
  const registry = createRunningRegistry();
  const calls: string[] = [];
  let enabled = true;
  let foreground = true;
  const enabledListeners = new Set<() => void>();
  const fgListeners = new Set<() => void>();
  const controller = createKeepAwake({
    native: {
      activate: async (tag) => void calls.push(`on:${tag}`),
      deactivate: async (tag) => void calls.push(`off:${tag}`),
      ...native,
    },
    registry,
    enabled: () => enabled,
    subscribeEnabled: (fn) => (enabledListeners.add(fn), () => enabledListeners.delete(fn)),
    foreground: () => foreground,
    subscribeForeground: (fn) => (fgListeners.add(fn), () => fgListeners.delete(fn)),
  });
  return {
    registry,
    calls,
    controller,
    setEnabled(on: boolean) {
      enabled = on;
      enabledListeners.forEach((fn) => fn());
    },
    setForeground(on: boolean) {
      foreground = on;
      fgListeners.forEach((fn) => fn());
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('keep awake while running', () => {
  it('keeps the screen on, with its own tag, once something has run for a moment, until all of it ends', async () => {
    const { registry, calls, controller } = setup();
    registry.set('shell-1', true);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    await flush();
    expect(calls).toEqual([`on:${KEEP_AWAKE_TAG}`]);
    expect(controller.active).toBe(true);
    registry.set('remote-2', true);
    registry.set('shell-1', false);
    expect(calls).toHaveLength(1);
    registry.set('remote-2', false);
    expect(calls).toEqual([`on:${KEEP_AWAKE_TAG}`, `off:${KEEP_AWAKE_TAG}`]);
    expect(controller.active).toBe(false);
  });

  it("doesn't turn on for quick commands", () => {
    const { registry, calls } = setup();
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS - 100);
    registry.set('shell-1', false);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(calls).toEqual([]);
  });

  it('lets go when the setting is turned off mid-run, and comes back when it is turned on', async () => {
    const { registry, calls, setEnabled } = setup();
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    setEnabled(false);
    expect(calls).toEqual(['on:tide-running', 'off:tide-running']);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS * 2);
    expect(calls).toHaveLength(2);
    setEnabled(true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(calls).toEqual(['on:tide-running', 'off:tide-running', 'on:tide-running']);
  });

  it('lets go in the background', () => {
    const { registry, calls, setForeground } = setup();
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    setForeground(false);
    expect(calls).toEqual(['on:tide-running', 'off:tide-running']);
    setForeground(true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(calls).toHaveLength(3);
  });

  it('survives the native call failing, and tries again on the next run', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let fail = true;
    const activate = jest.fn(async () => {
      if (fail) throw new Error('no module');
    });
    const deactivate = jest.fn(() => {
      throw new Error('boom');
    });
    const { registry, controller } = setup({ activate, deactivate });
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    await flush();
    expect(controller.active).toBe(false);
    registry.set('shell-1', false);
    expect(deactivate).not.toHaveBeenCalled();
    fail = false;
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    await flush();
    expect(controller.active).toBe(true);
    expect(() => registry.set('shell-1', false)).not.toThrow();
    expect(controller.active).toBe(false);
    warn.mockRestore();
  });

  it('releases again when everything ended while turning on', async () => {
    let resolve!: () => void;
    const { registry, calls } = setup({ activate: () => new Promise<void>((r) => (resolve = r)) });
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    registry.set('shell-1', false);
    resolve();
    await flush();
    expect(calls.filter((c) => c.startsWith('off'))).not.toHaveLength(0);
  });

  it('releases when disposed (the project closed)', () => {
    const { registry, calls, controller } = setup();
    registry.set('shell-1', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    controller.dispose();
    expect(calls).toEqual(['on:tide-running', 'off:tide-running']);
    registry.set('shell-2', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(calls).toHaveLength(2);
  });
});

describe('startKeepAwake', () => {
  it('drives expo-keep-awake from the app registry, the setting and the app state', async () => {
    const { startKeepAwake, stopKeepAwake } = require('./keepAwake') as typeof import('./keepAwake');
    const { running } = require('./running') as typeof import('./running');
    const controller = startKeepAwake();
    expect(startKeepAwake()).toBe(controller);
    running.set('shell-x', true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(mockKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);

    mockSettings.getState().setKeepAwake(false);
    expect(mockKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    mockSettings.getState().setKeepAwake(true);
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(mockKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);

    mockAppState.currentState = 'background';
    mockAppState.listeners.forEach((fn) => fn());
    expect(mockKeepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(2);
    mockAppState.currentState = 'active';
    mockAppState.listeners.forEach((fn) => fn());
    jest.advanceTimersByTime(ACTIVATE_DELAY_MS);
    expect(mockKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(3);

    running.set('shell-x', false);
    expect(mockKeepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(3);
    stopKeepAwake();
    expect(mockAppState.listeners.size).toBe(0);
  });
});
