import { createGitHub, GitHubError, parseRemote, repoOf, timeAgo } from './api';
import { pollDeviceFlow, startDeviceFlow, waitForToken } from './auth';

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GitHub API', () => {
  it('sends the token and API version, and posts JSON', async () => {
    const calls: [string, RequestInit][] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return json(201, { number: 7 });
    }) as unknown as typeof fetch;
    const gh = createGitHub('tok', fetchImpl);
    await gh.createIssue('ada', 'my repo', 'Bug', 'Steps');
    expect(calls[0][0]).toBe('https://api.github.com/repos/ada/my%20repo/issues');
    expect(calls[0][1].method).toBe('POST');
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ title: 'Bug', body: 'Steps' });
  });

  it('leaves pull requests out of the issue list', async () => {
    const gh = createGitHub('t', (async () => json(200, [{ number: 1 }, { number: 2, pull_request: {} }])) as unknown as typeof fetch);
    expect((await gh.issues('a', 'b')).map((i) => i.number)).toEqual([1]);
  });

  it('turns errors into readable messages', async () => {
    const gh = createGitHub('t', (async () => json(422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] })) as unknown as typeof fetch);
    await expect(gh.createPull('a', 'b', { title: 't', body: '', head: 'x', base: 'main' })).rejects.toThrow('A pull request already exists');
    const expired = createGitHub('t', (async () => json(401, { message: 'Bad credentials' })) as unknown as typeof fetch);
    await expect(expired.user()).rejects.toBeInstanceOf(GitHubError);
    await expect(expired.user()).rejects.toThrow('Sign in again');
  });

  it('reads owner and repo from remotes and search results', () => {
    expect(parseRemote('https://github.com/ada/engine.git')).toEqual({ owner: 'ada', repo: 'engine' });
    expect(parseRemote('git@github.com:ada/engine.git')).toEqual({ owner: 'ada', repo: 'engine' });
    expect(parseRemote('https://gitlab.com/ada/engine.git')).toBeNull();
    expect(repoOf({ repository_url: 'https://api.github.com/repos/ada/engine' } as never)).toEqual({ owner: 'ada', repo: 'engine' });
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(timeAgo('2026-10-29T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-29T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2026-10-28T12:00:00Z', now)).toBe('1 day ago');
  });
});

describe('GitHub device sign-in', () => {
  const code = { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 };

  it('asks for a code with the scopes Tide needs', async () => {
    let sent: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return json(200, code);
    }) as unknown as typeof fetch;
    expect(await startDeviceFlow('client', fetchImpl)).toEqual(code);
    expect(sent).toEqual({ client_id: 'client', scope: 'repo workflow read:org' });
  });

  it('handles pending, slow down, success and errors', async () => {
    const answer = (body: unknown) => (async () => json(200, body)) as unknown as typeof fetch;
    expect(await pollDeviceFlow(code, 5, 'c', answer({ error: 'authorization_pending' }))).toEqual({ wait: 5 });
    expect(await pollDeviceFlow(code, 5, 'c', answer({ error: 'slow_down', interval: 10 }))).toEqual({ wait: 10 });
    expect(await pollDeviceFlow(code, 5, 'c', answer({ access_token: 'gho_x' }))).toEqual({ token: 'gho_x' });
    expect(await pollDeviceFlow(code, 5, 'c', answer({ error: 'access_denied' }))).toEqual({ error: 'Sign-in was cancelled on GitHub.' });
  });

  it('polls until the token arrives, waiting as told', async () => {
    const waits: number[] = [];
    const answers = [{ wait: 5 }, { wait: 10 }, { token: 'gho_y' }];
    const token = await waitForToken(
      code,
      () => false,
      async (s) => {
        waits.push(s);
      },
      async () => answers.shift()!,
    );
    expect(token).toBe('gho_y');
    expect(waits).toEqual([5, 5, 10]);
  });

  it('stops when cancelled', async () => {
    let cancelled = false;
    const token = await waitForToken(
      code,
      () => cancelled,
      async () => {
        cancelled = true;
      },
      async () => ({ wait: 5 }),
    );
    expect(token).toBeNull();
  });
});
