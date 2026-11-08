import { createLastRunStore } from './lastRun';
import { createSpotlightSync } from './spotlight';

describe('Spotlight sync', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup() {
    const native = { index: jest.fn(async () => undefined), remove: jest.fn(async () => undefined) };
    return { native, sync: createSpotlightSync(native, { delay: 1000 }) };
  }

  it('indexes once for changes close together, and skips unchanged lists', () => {
    const { native, sync } = setup();
    sync.update([{ name: 'a' }]);
    sync.update([{ name: 'a' }, { name: 'b', language: 'TS' }]);
    expect(native.index).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(native.index).toHaveBeenCalledTimes(1);
    expect(native.index).toHaveBeenCalledWith([{ name: 'a' }, { name: 'b', language: 'TS' }]);
    sync.update([{ name: 'a' }, { name: 'b', language: 'TS' }]);
    jest.advanceTimersByTime(1000);
    expect(native.index).toHaveBeenCalledTimes(1);
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('removes renamed and deleted projects', () => {
    const { native, sync } = setup();
    sync.update([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    jest.advanceTimersByTime(1000);
    // b renamed to b2, c deleted.
    sync.update([{ name: 'a' }, { name: 'b2' }]);
    jest.advanceTimersByTime(1000);
    expect(native.remove).toHaveBeenCalledWith(['b', 'c']);
    expect(native.index).toHaveBeenLastCalledWith([{ name: 'a' }, { name: 'b2' }]);
  });

  it('stops', () => {
    const { native, sync } = setup();
    sync.update([{ name: 'a' }]);
    sync.stop();
    jest.advanceTimersByTime(1000);
    sync.update([{ name: 'b' }]);
    jest.advanceTimersByTime(1000);
    expect(native.index).not.toHaveBeenCalled();
  });
});

describe('last run store', () => {
  const memory = () => {
    const data: Record<string, string> = {};
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), removeItem: (k: string) => void delete data[k] };
  };
  const run = { project: 'site', command: 'npm test', kind: 'tests' as const, status: 'failed' as const, detail: '1 of 3 failed', exitCode: 1, startedAt: 1, endedAt: 2 };

  it('keeps the last run and follows renames and deletes', () => {
    const store = createLastRunStore(memory());
    store.getState().record(run);
    expect(store.getState().lastRun).toEqual(run);
    store.getState().renameProject('other', 'x');
    expect(store.getState().lastRun?.project).toBe('site');
    store.getState().renameProject('site', 'web');
    expect(store.getState().lastRun?.project).toBe('web');
    store.getState().forget('site');
    expect(store.getState().lastRun).not.toBeNull();
    store.getState().forget('web');
    expect(store.getState().lastRun).toBeNull();
  });
});
