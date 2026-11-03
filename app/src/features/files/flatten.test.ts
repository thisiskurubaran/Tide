import { changeLetter } from '../git/status';
import { filterTree, gitDecorations, matchesFilter, visibleRows } from './flatten';
import type { TreeNode } from './workspace';

const tree: TreeNode[] = [
  {
    name: 'src',
    path: 'src',
    kind: 'dir',
    children: [
      { name: 'lib', path: 'src/lib', kind: 'dir', children: [{ name: 'a.ts', path: 'src/lib/a.ts', kind: 'file' }] },
      { name: 'index.ts', path: 'src/index.ts', kind: 'file' },
    ],
  },
  { name: 'node_modules', path: 'node_modules', kind: 'dir', unlisted: true },
  { name: 'package.json', path: 'package.json', kind: 'file' },
];

const show = (expanded: string[]) =>
  visibleRows(tree, new Set(expanded)).map((r) => `${'  '.repeat(r.depth)}${r.kind === 'node' ? r.node.name : '(not listed)'}`);

describe('visibleRows', () => {
  it('lists only what expanded folders reveal', () => {
    expect(show([])).toEqual(['src', 'node_modules', 'package.json']);
    expect(show(['src', 'node_modules'])).toEqual(['src', '  lib', '  index.ts', 'node_modules', '  (not listed)', 'package.json']);
    // A collapsed parent hides an expanded child.
    expect(show(['src/lib'])).toEqual(['src', 'node_modules', 'package.json']);
  });
});

describe('filterTree', () => {
  const names = (query: string) => {
    const { nodes, expand } = filterTree(tree, query);
    return visibleRows(nodes, expand).map((r) => `${'  '.repeat(r.depth)}${r.kind === 'node' ? r.node.name : '(not listed)'}`);
  };

  it('keeps the whole tree for an empty query', () => {
    expect(filterTree(tree, '  ').nodes).toBe(tree);
  });

  it('keeps matching files and opens the folders on the way', () => {
    expect(names('A.T')).toEqual(['src', '  lib', '    a.ts']);
    expect(names('.ts')).toEqual(['src', '  lib', '    a.ts', '  index.ts']);
    expect(names('pack')).toEqual(['package.json']);
    expect(names('nothing')).toEqual([]);
  });

  it('matches folder names only through a path query', () => {
    expect(names('lib')).toEqual([]);
    expect(names('lib/')).toEqual(['src', '  lib', '    a.ts']);
    expect(matchesFilter({ name: 'a.ts', path: 'src/lib/a.ts', kind: 'file' }, 'SRC/LIB')).toBe(true);
  });
});

describe('gitDecorations', () => {
  it('gives files their letter and marks the folders above them', () => {
    const git = gitDecorations({ 'src/lib/a.ts': ' M', 'gone.js': ' D', 'new/': '??', 'b.ts': 'A ' }, changeLetter);
    expect(git.letterFor('src/lib/a.ts')).toBe('M');
    expect(git.letterFor('gone.js')).toBe('D');
    expect(git.letterFor('b.ts')).toBe('U');
    expect(git.letterFor('src/index.ts')).toBeNull();
    // An untracked folder covers everything inside it.
    expect(git.letterFor('new/deep/x.ts')).toBe('U');
    expect(git.letterFor('newer.ts')).toBeNull();
    expect(['src', 'src/lib', 'new', 'new/deep'].map(git.isDirty)).toEqual([true, true, true, true]);
    expect(git.isDirty('lib')).toBe(false);
  });

  it('handles no status', () => {
    expect(gitDecorations(undefined, changeLetter).letterFor('a')).toBeNull();
  });
});
