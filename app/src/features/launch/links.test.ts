import { launchParams, projectLink, projectPath, quickActions } from './links';

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
