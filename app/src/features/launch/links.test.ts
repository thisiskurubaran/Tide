import { deployConfirmation, launchConfirmation, launchParams, projectLink, projectPath, quickActions } from './links';

describe('links into Tide', () => {
  it('builds project links', () => {
    expect(projectLink('my app')).toBe('tide://project/my%20app');
    expect(projectPath('web', { file: 'src/index.ts', line: 12, run: true })).toBe('/project/web?file=src%2Findex.ts&line=12&run=1');
    expect(projectPath('web', { line: 3 })).toBe('/project/web');
  });

  it('reads what a link asks for', () => {
    expect(launchParams({})).toBeNull();
    expect(launchParams({ file: 'a.py', line: '4' })).toEqual({ file: 'a.py', line: 4, run: false });
    expect(launchParams({ run: '1', line: 'x' })).toEqual({ file: undefined, line: undefined, run: true });
  });

  it('offers recent projects that still exist as quick actions', () => {
    const actions = quickActions(['b', 'gone', 'a', 'c', 'd'], ['a', 'b', 'c', 'd']);
    expect(actions.map((a) => a.title)).toEqual(['New project', 'b', 'a', 'c']);
    expect(actions[1].params.href).toBe('/project/b');
  });
});

describe('send links', () => {
  it('round-trips a request to send', () => {
    expect(projectPath('demo', { file: 'api.http', send: 'List users' })).toBe('/project/demo?file=api.http&send=List+users');
    expect(launchParams({ file: 'api.http', send: '1' })).toEqual({ file: 'api.http', line: undefined, run: false, send: '1' });
    // Without a file there's nothing to send.
    expect(launchParams({ send: '1', run: '1' })?.send).toBeUndefined();
  });
});

describe('tests and stop links', () => {
  it('round-trips them', () => {
    expect(projectLink('habit tracker', { tests: true })).toBe('tide://project/habit%20tracker?tests=1');
    expect(projectPath('web', { stop: true })).toBe('/project/web?stop=1');
    expect(launchParams({ tests: '1' })).toEqual({ file: undefined, line: undefined, run: false, tests: true });
    expect(launchParams({ stop: 'true' })?.stop).toBe(true);
    expect(launchParams({ run: '1' })).not.toHaveProperty('tests');
  });
});

describe('links that act ask first', () => {
  it('names the project and the action for run, tests and send', () => {
    const run = launchConfirmation('web', launchParams({ run: '1' }));
    expect(run).toMatchObject({ title: 'Run \u201cweb\u201d?', action: 'Run' });
    expect(run?.message).toContain('\u201cweb\u201d and run it');
    expect(launchConfirmation('web', launchParams({ tests: '1' }))?.message).toContain('run its tests');
    const send = launchConfirmation('api', launchParams({ file: 'a.http', send: 'Login' }));
    expect(send).toMatchObject({ title: 'Send request?', action: 'Send' });
    expect(send?.message).toContain('send the request \u201cLogin\u201d in \u201ca.http\u201d');
    expect(launchConfirmation('api', launchParams({ file: 'a.http', send: '1', run: '1' }))?.message).toContain('the first request in \u201ca.http\u201d and run it');
    // A number is a position, and the dialog says so, rather than naming a request "3".
    expect(launchConfirmation('api', launchParams({ file: 'a.http', send: '3' }))?.message).toContain('send the third request in \u201ca.http\u201d');
    expect(launchConfirmation('api', launchParams({ file: 'a.http', send: '999' }))?.message).toContain('send request number 999');
    expect(launchParams({ file: 'a.http', send: '0' })?.send).toBeUndefined();
  });

  it("doesn't ask for links that only open or stop", () => {
    expect(launchConfirmation('web', launchParams({ file: 'a.ts', line: '3' }))).toBeNull();
    expect(launchConfirmation('web', launchParams({ stop: '1' }))).toBeNull();
    expect(launchConfirmation('web', null)).toBeNull();
  });

  it('asks before a deploy', () => {
    expect(deployConfirmation('a&go=1')).toMatchObject({ title: 'Deploy \u201ca&go=1\u201d?', action: 'Deploy' });
  });
});
