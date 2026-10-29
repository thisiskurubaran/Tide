import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { fuzzyFilter, fuzzyScore } from './fuzzy';
import { buildMatcher, pathFilter, planReplace, replaceInText, SearchError, searchProject } from './search';

async function project() {
  const workspace = createWorkspace(createMemoryFs());
  await workspace.createProject('p', 'node-hello');
  await workspace.createFolder('p', '', 'src');
  await workspace.createFile('p', 'src', 'app.js', 'const Port = 1;\nlisten(port)\n');
  await workspace.createFolder('p', '', 'node_modules');
  await workspace.createFile('p', 'node_modules', 'dep.js', 'port');
  await workspace.createFile('p', '', 'bin.dat', 'port\u0000');
  return workspace;
}

describe('searchProject', () => {
  it('finds matches with line and column, skipping node_modules and binary files', async () => {
    const result = await searchProject(await project(), 'p', 'port');
    expect(result.files.map((f) => f.path)).toEqual(['src/app.js']);
    expect(result.files[0].matches).toEqual([
      { line: 1, column: 6, length: 4, text: 'const Port = 1;' },
      { line: 2, column: 7, length: 4, text: 'listen(port)' },
    ]);
    expect(result.total).toBe(2);
  });

  it('trims indentation and cuts long lines around the match', async () => {
    const workspace = await project();
    await workspace.createFile('p', '', 'long.js', `    ${'x'.repeat(300)}needle${'y'.repeat(300)}`);
    const [m] = (await searchProject(workspace, 'p', 'needle')).files[0].matches;
    expect(m.text.startsWith('...')).toBe(true);
    expect(m.text.slice(m.column, m.column + 6)).toBe('needle');
    await workspace.createFile('p', '', 'indent.js', '      call(port)');
    const hit = (await searchProject(workspace, 'p', 'port')).files.find((f) => f.path === 'indent.js')!.matches[0];
    expect(hit).toEqual({ line: 1, column: 5, length: 4, text: 'call(port)' });
  });

  it('can match case', async () => {
    const result = await searchProject(await project(), 'p', 'Port', { caseSensitive: true });
    expect(result.files[0].matches.map((m) => m.line)).toEqual([1]);
  });

  it('returns nothing for an empty query', async () => {
    expect((await searchProject(await project(), 'p', '')).files).toEqual([]);
  });
});

describe('search options', () => {
  it('matches whole words and regular expressions', async () => {
    const workspace = await project();
    await workspace.createFile('p', '', 'w.js', 'export const portal = 1;\nconst port2 = port;\n');
    const words = await searchProject(workspace, 'p', 'port', { wholeWord: true, include: 'w.js' });
    expect(words.files[0].matches).toEqual([{ line: 2, column: 14, length: 4, text: 'const port2 = port;' }]);
    const re = await searchProject(workspace, 'p', 'port\\d', { regex: true, include: 'w.js' });
    expect(re.files[0].matches[0]).toMatchObject({ line: 2, column: 6, length: 5 });
  });

  it('reports a bad regular expression', () => {
    expect(() => buildMatcher('(', { regex: true })).toThrow(SearchError);
  });

  it('filters paths with include and exclude globs', () => {
    const keep = pathFilter('src/**, *.md', 'test, *.spec.ts');
    expect(['src/a.ts', 'src/deep/b.ts', 'README.md', 'docs/x.md', 'lib/c.ts', 'src/a.spec.ts', 'test/t.md'].filter(keep)).toEqual([
      'src/a.ts',
      'src/deep/b.ts',
      'README.md',
      'docs/x.md',
    ]);
    expect(['a.js', 'b/c.js'].filter(pathFilter('', ''))).toEqual(['a.js', 'b/c.js']);
    expect(['src/a/b.ts', 'src/b.ts'].filter(pathFilter('src/*.ts'))).toEqual(['src/b.ts']);
  });
});

describe('replace', () => {
  it('replaces literally, with $ kept as text', () => {
    expect(replaceInText('a.b a.b', buildMatcher('a.b'), '$1x', false)).toEqual({ text: '$1x $1x', count: 2 });
  });

  it('expands groups in regex mode, keeping anchors and word boundaries', () => {
    const m = buildMatcher('^(\\w+) = (?<v>\\d+)$', { regex: true });
    expect(replaceInText('port = 80', m, '$<v> is $1 ($&) $$', true)).toEqual({ text: '80 is port (port = 80) $', count: 1 });
    expect(replaceInText('foo food', buildMatcher('foo', { wholeWord: true }), 'bar', false)).toEqual({ text: 'bar food', count: 1 });
  });

  it('plans changes per file without writing', async () => {
    const workspace = await project();
    const plan = await planReplace(workspace, 'p', 'port', 'PORT', {});
    expect(plan.map((f) => [f.path, f.count])).toEqual([['src/app.js', 2]]);
    expect(plan[0].after).toBe('const PORT = 1;\nlisten(PORT)\n');
    expect(await workspace.readFile('p', 'src/app.js')).toContain('Port');
    expect(await planReplace(workspace, 'p', 'port', 'x', {}, ['README.md'])).toEqual([]);
  });
});

describe('fuzzy', () => {
  it('matches subsequences and ranks file names first', () => {
    expect(fuzzyScore('xyz', 'src/app.js')).toBeNull();
    const files = ['src/routes/index.js', 'index.js', 'notes/indexing.md'];
    expect(fuzzyFilter(files, 'index', (f) => f)[0]).toBe('index.js');
    expect(fuzzyFilter(files, 'rix', (f) => f)).toEqual(['src/routes/index.js']);
  });
});
