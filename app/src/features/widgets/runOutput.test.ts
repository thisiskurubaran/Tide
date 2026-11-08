import { createRunActivity, initialState, localAddress, readLine, result, RunActivityNative, RunState, testSummary, view } from './runOutput';

const feed = (state: RunState, text: string) => text.split('\n').reduce(readLine, state);

describe('test summaries', () => {
  it('reads jest', () => {
    expect(testSummary('Tests:       3 failed, 38 passed, 52 total')).toEqual({ passed: 38, failed: 3, skipped: 0, total: 52 });
    expect(testSummary('Tests:       1 skipped, 4 passed, 5 total')).toEqual({ passed: 4, failed: 0, skipped: 1, total: 5 });
    expect(testSummary('Test Suites: 1 failed, 4 passed, 5 total')).toBeNull();
  });

  it('reads vitest', () => {
    expect(testSummary('      Tests  3 failed | 38 passed (41)')).toEqual({ passed: 38, failed: 3, skipped: 0, total: 41 });
    expect(testSummary(' Test Files  1 failed | 4 passed (5)')).toBeNull();
  });

  it('reads pytest', () => {
    expect(testSummary('============ 3 passed in 0.12s ============')).toEqual({ passed: 3, failed: 0, skipped: 0, total: 3 });
    expect(testSummary('== 2 failed, 38 passed, 1 skipped, 1 error in 1.50s ==')).toEqual({ passed: 38, failed: 3, skipped: 1, total: 42 });
    expect(testSummary('some passed in a while')).toBeNull();
  });

  it('reads node --test over several lines', () => {
    const s = feed(initialState('tests', 'node --test'), '# tests 52\n# pass 50\n# fail 2');
    expect(view(s)).toEqual({ detail: '52 of 52 · 2 failed', progress: 1 });
  });
});

describe('what a test run shows', () => {
  it('starts with the given detail, then the counts', () => {
    let s = initialState('tests', 'npm test');
    expect(view(s)).toEqual({ detail: 'Running tests…', progress: null });
    s = feed(s, '\u001b[1mPASS\u001b[22m src/a.test.ts\nFAIL src/b.test.ts');
    expect(view(s).detail).toBe('2 files · 1 failed');
    s = readLine(s, 'Tests:       0 failed, 38 passed, 52 total');
    expect(view(s)).toEqual({ detail: '38 of 52 · 0 failed', progress: 38 / 52 });
  });

  it('follows pytest progress', () => {
    const s = feed(initialState('tests', 'pytest'), 'collected 10 items\n\ntests/test_a.py ..F.       [ 40%]');
    expect(view(s)).toEqual({ detail: '4 of 10 · 1 failed', progress: 0.4 });
  });

  it('ends with the result', () => {
    const s = initialState('tests', 'npm test');
    expect(result(readLine(s, 'Tests:       52 passed, 52 total'), 0)).toEqual({ status: 'passed', detail: 'All 52 passed' });
    expect(result(readLine(s, 'Tests:       3 failed, 49 passed, 52 total'), 1)).toEqual({ status: 'failed', detail: '3 of 52 failed' });
    expect(result(s, 1)).toEqual({ status: 'failed', detail: 'Failed (exit code 1)' });
    expect(result(s, 130)).toEqual({ status: 'stopped', detail: 'Stopped' });
    expect(result(s, null)).toEqual({ status: 'stopped', detail: 'Stopped' });
  });
});

describe('what a dev server shows', () => {
  it('finds the local address', () => {
    expect(localAddress('  ➜  Local:   http://localhost:5173/')).toBe('localhost:5173');
    expect(localAddress('Server running at http://127.0.0.1:3000')).toBe('localhost:3000');
    expect(localAddress('Network: http://192.168.1.4:5173/')).toBe('192.168.1.4:5173');
    expect(localAddress('see https://vitejs.dev')).toBeNull();
  });

  it('shows the address and the errors since the last good build', () => {
    let s = initialState('server', 'npm run dev');
    expect(view(s).detail).toBe('Starting…');
    s = feed(s, '  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.4:5173/');
    expect(view(s)).toEqual({ detail: 'localhost:5173 · 0 errors', progress: null });
    s = readLine(s, '[vite] Internal server error: Unexpected token');
    expect(view(s).detail).toBe('localhost:5173 · 1 error');
    s = readLine(s, '[vite] hmr update /src/App.tsx');
    expect(view(s).detail).toBe('localhost:5173 · 0 errors');
    expect(result(s, 0)).toEqual({ status: 'stopped', detail: 'Stopped' });
    expect(result(s, 1)).toEqual({ status: 'failed', detail: 'Exited with code 1' });
  });
});

describe('what a task shows', () => {
  it('shows its last line, then done or the exit code', () => {
    const s = feed(initialState('task', 'npm run build'), 'building…\n\u001b[32m✓ built in 1.2s\u001b[0m\n');
    expect(view(s).detail).toBe('✓ built in 1.2s');
    expect(result(s, 0)).toEqual({ status: 'passed', detail: 'Done' });
    expect(result(s, 2)).toEqual({ status: 'failed', detail: 'Exited with code 2' });
  });
});

describe('run Live Activity controller', () => {
  const flush = () => new Promise((r) => jest.requireActual<typeof import('timers')>('timers').setImmediate(r));

  function setup(enabled = true) {
    const calls: unknown[][] = [];
    const native: RunActivityNative = {
      start: jest.fn(async (args) => (calls.push(['start', args]), 'act1')),
      update: jest.fn(async (id, args) => void calls.push(['update', id, args])),
      end: jest.fn(async (id, args) => void calls.push(['end', id, args])),
    };
    return { calls, native, run: createRunActivity(native, { enabled: () => enabled }) };
  }

  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('starts, throttles updates to one per 2s, and ends', async () => {
    const { calls, run } = setup();
    run.onRunStart('habit-tracker', 'npm test', 'tests');
    run.onOutput('PASS a.test.ts\n');
    run.onOutput('PASS b.test.ts\nFA');
    run.onOutput('IL c.test.ts\n');
    await flush();
    expect(calls).toEqual([['start', { project: 'habit-tracker', command: 'npm test', kind: 'tests', detail: 'Running tests…' }]]);

    jest.advanceTimersByTime(2000);
    await flush();
    expect(calls[1]).toEqual(['update', 'act1', { status: 'running', detail: '3 files · 1 failed', progress: null }]);

    // Nothing new: no update.
    run.onOutput('  ✓ works\n');
    jest.advanceTimersByTime(5000);
    await flush();
    expect(calls).toHaveLength(2);

    // A while since the last one: goes out straight away.
    run.onOutput('Tests:       1 failed, 51 passed, 52 total\n');
    await flush();
    expect(calls[2]).toEqual(['update', 'act1', { status: 'running', detail: '52 of 52 · 1 failed', progress: 1 }]);

    run.onExit(1);
    await flush();
    expect(calls[3]).toEqual(['end', 'act1', { status: 'failed', detail: '1 of 52 failed' }]);
    // Output after the end is ignored.
    run.onOutput('late\n');
    jest.advanceTimersByTime(5000);
    await flush();
    expect(calls).toHaveLength(4);
  });

  it('ends a run that is still going when another starts', async () => {
    const { calls, run } = setup();
    run.onRunStart('a', 'npm run dev', 'server');
    run.onRunStart('a', 'npm test', 'tests');
    await flush();
    expect(calls.map((c) => c[0])).toEqual(['start', 'start', 'end']);
    expect(calls[2]).toEqual(['end', 'act1', { status: 'stopped', detail: 'Stopped' }]);
  });

  it('reports every result for the Last run widget, with Live Activities on or off', async () => {
    for (const enabled of [true, false]) {
      const results: unknown[] = [];
      const native: RunActivityNative = { start: jest.fn(async () => 'act1'), update: jest.fn(async () => undefined), end: jest.fn(async () => undefined) };
      const run = createRunActivity(native, { enabled: () => enabled, onResult: (r) => results.push(r) });
      jest.setSystemTime(10_000);
      run.onRunStart('site', 'npm test', 'tests');
      run.onOutput('Tests:       2 failed, 3 passed, 5 total');
      jest.setSystemTime(12_500);
      run.onExit(1);
      await flush();
      expect(results).toEqual([
        { project: 'site', command: 'npm test', kind: 'tests', status: 'failed', detail: '2 of 5 failed', exitCode: 1, startedAt: 10_000, endedAt: 12_500 },
      ]);
      expect(native.start).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(native.end).toHaveBeenCalledTimes(enabled ? 1 : 0);
    }
  });

  it('does nothing when Live Activities are off or unavailable', async () => {
    const { calls, run } = setup(false);
    run.onRunStart('a', 'npm test', 'tests');
    run.onOutput('Tests: 1 passed, 1 total\n');
    run.onExit(0);
    await flush();
    expect(calls).toEqual([]);

    const unavailable = setup();
    (unavailable.native.start as jest.Mock).mockResolvedValue(null);
    unavailable.run.onRunStart('a', 'npm test', 'tests');
    unavailable.run.onExit(0);
    await flush();
    expect(unavailable.native.end).not.toHaveBeenCalled();
  });
});
