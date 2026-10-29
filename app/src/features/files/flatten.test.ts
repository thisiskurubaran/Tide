import { visibleRows } from './flatten';
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
