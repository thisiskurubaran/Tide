import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { fuzzyFilter, fuzzyScore } from './fuzzy';
import { searchProject } from './search';

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
      { line: 1, column: 6, text: 'const Port = 1;' },
      { line: 2, column: 7, text: 'listen(port)' },
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
    expect(hit).toEqual({ line: 1, column: 5, text: 'call(port)' });
  });

  it('can match case', async () => {
    const result = await searchProject(await project(), 'p', 'Port', { caseSensitive: true });
    expect(result.files[0].matches.map((m) => m.line)).toEqual([1]);
  });

  it('returns nothing for an empty query', async () => {
    expect((await searchProject(await project(), 'p', '')).files).toEqual([]);
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
