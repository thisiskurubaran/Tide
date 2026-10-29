import type { TreeNode } from './workspace';

export type TreeRow =
  | { kind: 'node'; node: TreeNode; depth: number }
  // The note under an open node_modules (or similar) folder.
  | { kind: 'unlisted'; path: string; depth: number };

// The rows the tree shows: every node whose ancestors are all expanded, in
// order. A flat list lets the tree render only what is on screen.
export function visibleRows(nodes: TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      rows.push({ kind: 'node', node, depth });
      if (node.kind !== 'dir' || !expanded.has(node.path)) continue;
      if (node.unlisted) rows.push({ kind: 'unlisted', path: node.path, depth: depth + 1 });
      else if (node.children) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}
