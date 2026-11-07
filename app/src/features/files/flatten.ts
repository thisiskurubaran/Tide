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

// Whether a file matches the explorer's filter: a case-insensitive substring
// of the name, or of the whole path once the query has a "/" in it
// ("lib/a" finds src/lib/a.ts). Substring rather than fuzzy, so a short query
// in a big project doesn't light up every file.
export function matchesFilter(node: TreeNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (q.includes('/') ? node.path : node.name).toLowerCase().includes(q);
}

// The tree cut down to files matching the query and the folders on the way
// to them, plus those folders' paths so the tree can open them all. Unlisted
// folders (node_modules) have no children to search and drop out.
export function filterTree(nodes: TreeNode[], query: string): { nodes: TreeNode[]; expand: Set<string> } {
  const expand = new Set<string>();
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of list) {
      if (node.kind !== 'dir') {
        if (matchesFilter(node, query)) out.push(node);
        continue;
      }
      const children = node.children ? walk(node.children) : [];
      if (children.length) {
        expand.add(node.path);
        out.push({ ...node, children });
      }
    }
    return out;
  };
  return { nodes: query.trim() ? walk(nodes) : nodes, expand };
}

export type ChangeLetter = 'M' | 'U' | 'D';

export interface GitDecorations {
  // The letter for a file, or null when it's unchanged.
  letterFor(path: string): ChangeLetter | null;
  // Folders with a changed file somewhere inside get a dot.
  isDirty(path: string): boolean;
}

// Turns `git status -s` paths into what the tree draws. Git reports a new
// folder once, as "dir/", so files under it count as untracked too.
export function gitDecorations(
  changes: Record<string, string> | undefined,
  letter: (code: string | undefined) => ChangeLetter | null,
): GitDecorations {
  const files = new Map<string, ChangeLetter>();
  const untrackedDirs: string[] = [];
  const dirty = new Set<string>();
  for (const [raw, code] of Object.entries(changes ?? {})) {
    const l = letter(code);
    if (!l) continue;
    const path = raw.replace(/\/+$/, '');
    if (raw.endsWith('/')) {
      untrackedDirs.push(path);
      dirty.add(path);
    } else files.set(path, l);
    for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) dirty.add(path.slice(0, i));
  }
  const inUntracked = (path: string) => untrackedDirs.some((d) => path.startsWith(`${d}/`));
  return {
    letterFor: (path) => files.get(path) ?? (inUntracked(path) ? 'U' : null),
    isDirty: (path) => dirty.has(path) || inUntracked(path),
  };
}
