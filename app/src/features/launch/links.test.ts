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
