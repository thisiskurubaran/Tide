import {
  AgentSnapshot,
  agentResult,
  agentView,
  createAgentActivity,
  createGitActivity,
  createInstallActivity,
  gitProgress,
  gitResultDetail,
  installDetail,
  installResult,
  remoteLabel,
  throttled,
  withGitActivity,
} from './activities';

const flush = () => new Promise((r) => jest.requireActual<typeof import('timers')>('timers').setImmediate(r));

beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
afterEach(() => jest.useRealTimers());

function recorder<S extends string | null>(startId: S = 'act1' as S) {
  const calls: unknown[][] = [];
  return {
    calls,
    native: {
      start: jest.fn(async (args: unknown) => (calls.push(['start', args]), startId)),
      update: jest.fn(async (id: string, args: unknown) => void calls.push(['update', id, args])),
      end: jest.fn(async (id: string, args: unknown) => void calls.push(['end', id, args])),
    },
  };
}

describe('throttled updates', () => {
  it('sends at most one per interval, the latest wins, repeats are dropped, and nothing after the end', async () => {
    const sent: unknown[] = [];
    const t = throttled<number, string>(Promise.resolve('id'), async (_id, n) => void sent.push(n), async (_id, r) => void sent.push(r), 1000);
    t.update(1);
    t.update(2);
    t.update(3);
    await flush();
    expect(sent).toEqual([1]);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(sent).toEqual([1, 3]);
    t.update(3);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(sent).toEqual([1, 3]);
    // Immediate skips the wait.
    t.update(4, true);
    await flush();
    expect(sent).toEqual([1, 3, 4]);
    t.update(5);
    t.end('done');
    jest.advanceTimersByTime(5000);
    await flush();
    expect(sent).toEqual([1, 3, 4, 'done']);
    t.end('again');
    await flush();
    expect(sent).toHaveLength(4);
  });

  it('does nothing when the activity never started', async () => {
    const send = jest.fn(async () => undefined);
    const finish = jest.fn(async () => undefined);
    const t = throttled<number, string>(Promise.resolve(null), send, finish, 0);
    t.update(1);
    t.end('x');
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});

describe('git progress', () => {
  it('reads the built-in git and real git progress lines', () => {
    expect(gitProgress('Cloning\n\r\x1b[KReceiving objects: 10% (3/30)\r\x1b[KReceiving objects: 45% (14/30)')).toEqual({ phase: 'Receiving objects', detail: '14/30', progress: 0.45 });
    expect(gitProgress('remote: Counting objects: 100% (12/12), done.\n')).toEqual({ phase: 'Counting objects', detail: '12/12', progress: 1 });
    expect(gitProgress('\r\x1b[KAnalyzing workdir: 120')).toEqual({ phase: 'Analyzing workdir', detail: '120', progress: null });
    expect(gitProgress('Already up to date.\n')).toBeNull();
  });

  it('labels remotes by host and path', () => {
    expect(remoteLabel('https://github.com/octocat/Hello-World.git')).toBe('github.com/octocat/Hello-World');
    expect(remoteLabel('git@gitlab.com:a/b.git')).toBe('gitlab.com/a/b');
    expect(remoteLabel('')).toBe('');
  });

  it('ends with what git said, or the error', () => {
    expect(gitResultDetail('clone', true, 'Receiving objects: 100% (3/3)\n')).toBe('Cloned');
    expect(gitResultDetail('pull', true, 'Fetching\nAlready up to date.\n')).toBe('Already up to date.');
    expect(gitResultDetail('push', true, 'Writing objects: 100% (3/3)\nmain -> main\n')).toBe('Pushed');
    expect(gitResultDetail('push', false, '', 'fatal: Authentication failed')).toBe('Authentication failed');
    expect(gitResultDetail('pull', false, 'fatal: not a git repository\n')).toBe('not a git repository');
    expect(gitResultDetail('clone', false, '')).toBe('Clone failed');
  });
});

describe('git Live Activity', () => {
  it('starts with the operation and remote, follows progress, and ends with the result', async () => {
    const { calls, native } = recorder();
    const git = createGitActivity(native, { interval: 1000 });
    const run = git.begin('site', 'clone', 'https://github.com/a/site.git');
    run.output('Cloning into .\n\r\x1b[KReceiving objects: 10% (1/10)');
    run.output('\r\x1b[KReceiving objects: 50% (5/10)');
    await flush();
    expect(calls[0]).toEqual(['start', { project: 'site', operation: 'clone', remote: 'github.com/a/site', detail: 'Connecting…' }]);
    expect(calls[1]).toEqual(['update', 'act1', { phase: 'Receiving objects', detail: '1/10', progress: 0.1 }]);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(calls[2]).toEqual(['update', 'act1', { phase: 'Receiving objects', detail: '5/10', progress: 0.5 }]);
    run.end(true);
    await flush();
    expect(calls[3]).toEqual(['end', 'act1', { status: 'done', detail: 'Cloned' }]);
  });

  it('ends as failed when the work fails or throws, and still returns or rethrows', async () => {
    const { calls, native } = recorder();
    const git = createGitActivity(native);
    await expect(withGitActivity(git, { project: 'p', operation: 'push' }, async () => ({ code: 128, stdout: '', stderr: 'fatal: could not read Username' }))).resolves.toMatchObject({ code: 128 });
    await expect(withGitActivity(git, { project: 'p', operation: 'pull' }, async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    await expect(withGitActivity(git, { project: 'p', operation: 'pull' }, async (onOutput) => (onOutput('Already up to date.\n'), null))).resolves.toBeNull();
    await flush();
    expect(calls.filter((c) => c[0] === 'end').map((c) => c[2])).toEqual([
      { status: 'failed', detail: 'could not read Username' },
      { status: 'failed', detail: 'offline' },
      { status: 'done', detail: 'Already up to date.' },
    ]);
  });

  it('does nothing when Live Activities are off', async () => {
    const { calls, native } = recorder();
    const run = createGitActivity(native, { enabled: () => false }).begin('p', 'pull');
    run.output('Receiving objects: 50% (1/2)\n');
    run.end(true);
    await flush();
    expect(calls).toEqual([]);
  });
});

describe('install Live Activity', () => {
  it('picks the lines worth showing and the result', () => {
    expect(installDetail('npm warn deprecated x')).toBeNull();
    expect(installDetail('\u001b[32madded 12 packages in 3s\u001b[0m')).toBe('added 12 packages in 3s');
    expect(installDetail('  Collecting requests\r')).toBe('Collecting requests');
    expect(installResult('npm', 0, 'added 12 packages in 3s')).toEqual({ status: 'done', detail: 'added 12 packages in 3s' });
    expect(installResult('pip', 0, 'Collecting requests')).toEqual({ status: 'done', detail: 'Done' });
    expect(installResult('npm', 1, 'npm error 404 Not Found')).toEqual({ status: 'failed', detail: 'npm error 404 Not Found' });
    expect(installResult('pip', 2, null)).toEqual({ status: 'failed', detail: 'pip exited with code 2' });
  });

  it('starts, shows the latest line, and ends', async () => {
    const { calls, native } = recorder();
    const run = createInstallActivity(native, { interval: 1000 }).begin('site', 'npm', 'Installing react');
    run.output('npm warn x\nadded 1 pack');
    run.output('age in 2s\n');
    await flush();
    expect(calls[0]).toEqual(['start', { project: 'site', tool: 'npm', packages: 'Installing react' }]);
    expect(calls[1]).toEqual(['update', 'act1', { detail: 'added 1 package in 2s' }]);
    run.end(0);
    await flush();
    expect(calls[2]).toEqual(['end', 'act1', { status: 'done', detail: 'added 1 package in 2s' }]);
  });
});

describe('agent Live Activity', () => {
  const step = (verb: string, chips: string[], status: string) => ({ kind: 'step' as const, step: { view: { verb, chips }, status } });
  const session = (over: Partial<AgentSnapshot> = {}, turn: Partial<AgentSnapshot['turns'][number]> = {}): AgentSnapshot => ({
    running: true,
    approval: null,
    turns: [{ prompt: 'Add a dark mode', status: 'running', items: [], ...turn }],
    ...over,
  });

  it('shows the step count, the current action and approvals', () => {
    expect(agentView(session())).toEqual({ status: 'working', steps: 0, action: 'Thinking…', command: null });
    const items = [step('Read', ['src/App.tsx'], 'done'), { kind: 'text' as const }, step('Edited', ['src/theme.ts'], 'running')];
    expect(agentView(session({}, { items }))).toEqual({ status: 'working', steps: 2, action: 'Editing src/theme.ts', command: null });
    expect(agentView(session({ approval: { command: 'npm install tailwind' } }, { items }))).toEqual({
      status: 'approval',
      steps: 2,
      action: 'Waiting for your approval',
      command: 'npm install tailwind',
    });
  });

  it('ends with how the turn ended', () => {
    const items = [step('Read', ['a'], 'done')];
    expect(agentResult(session({ running: false }, { status: 'done', message: 'Added a dark mode toggle.\nMore', items }))).toEqual({ status: 'done', steps: 1, action: 'Added a dark mode toggle.' });
    expect(agentResult(session({ running: false }, { status: 'error', message: 'Rate limited' }))).toEqual({ status: 'failed', steps: 0, action: 'Rate limited' });
    expect(agentResult(session({ running: false }, { status: 'stopped' }))).toEqual({ status: 'stopped', steps: 0, action: 'Stopped' });
  });

  it('starts with a turn, sends approvals straight away, and ends with the turn', async () => {
    const { calls, native } = recorder();
    const agent = createAgentActivity(native, { interval: 1500 });
    agent.onSession('site', session());
    await flush();
    expect(calls[0]).toEqual(['start', { project: 'site', prompt: 'Add a dark mode' }]);
    expect(calls[1]).toEqual(['update', 'act1', { status: 'working', steps: 0, action: 'Thinking…', command: null }]);
    agent.onSession('site', session({}, { items: [step('Read', ['a.ts'], 'running')] }));
    agent.onSession('site', session({ approval: { command: 'npm test' } }, { items: [step('Read', ['a.ts'], 'done'), step('Ran', ['npm test'], 'waiting')] }));
    await flush();
    expect(calls[2]).toEqual(['update', 'act1', { status: 'approval', steps: 2, action: 'Waiting for your approval', command: 'npm test' }]);
    // The throttled "Reading" update was replaced by the approval.
    jest.advanceTimersByTime(5000);
    await flush();
    expect(calls).toHaveLength(3);
    agent.onSession('site', session({ running: false }, { status: 'done', message: 'All done', items: [step('Ran', ['npm test'], 'done')] }));
    await flush();
    expect(calls[3]).toEqual(['end', 'act1', { status: 'done', steps: 1, action: 'All done' }]);
    // Not running and nothing live: nothing to do.
    agent.onSession('site', session({ running: false }));
    await flush();
    expect(calls).toHaveLength(4);
  });

  it('ends as stopped when the session is cleared, and does nothing when off', async () => {
    const { calls, native } = recorder();
    const agent = createAgentActivity(native);
    agent.onSession('a', session());
    agent.onSession('a', undefined);
    await flush();
    expect(calls[calls.length - 1]).toEqual(['end', 'act1', { status: 'stopped', steps: 0, action: 'Stopped' }]);

    const off = recorder();
    const disabled = createAgentActivity(off.native, { enabled: () => false });
    disabled.onSession('a', session());
    disabled.onSession('a', session({ running: false }, { status: 'done' }));
    await flush();
    expect(off.calls).toEqual([]);
  });
});
