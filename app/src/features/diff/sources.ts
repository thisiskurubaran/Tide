// What the compare view shows for each kind of comparison.
import { runGit } from '../git/runGit';
import { basename } from '../files/fs';
import type { Runner } from '../../runtime/runner';
import type { Workspace } from '../files/workspace';
import { splitConflicts } from './conflicts';

export type CompareWith = 'saved' | 'head' | 'merge' | { file: string };

export interface CompareRequest {
  path: string;
  with: CompareWith;
}

export interface Comparison {
  title: string;
  original: string;
  modified: string;
  controls: { accept: string; reject: string } | null;
  // Merges are saved with a button; other comparisons edit the open file live.
  saveExplicitly: boolean;
}

export class CompareError extends Error {}

interface Sources {
  workspace: Workspace;
  runner: Runner;
  // The open file's text, unsaved edits included.
  current(): Promise<string>;
}

export async function loadComparison(project: string, req: CompareRequest, { workspace, runner, current }: Sources): Promise<Comparison> {
  const name = basename(req.path);
  const mine = await current();
  if (req.with === 'saved') {
    return { title: `${name}: unsaved changes`, original: await workspace.readFile(project, req.path), modified: mine, controls: { accept: 'Keep', reject: 'Revert' }, saveExplicitly: false };
  }
  if (req.with === 'head') {
    const r = await runGit(runner, project, ['__tide', 'show', req.path]);
    if (r.code !== 0) throw new CompareError(/not a git repository|could not find/i.test(r.stderr) ? 'This project is not a Git repository.' : r.stderr.trim() || 'git failed');
    const versions = JSON.parse(r.stdout.trim().split('\n').pop() ?? 'null') as { binary: boolean; head?: string | null } | null;
    if (!versions || versions.binary) throw new CompareError("This file can't be compared as text.");
    return {
      title: `${name}: changes since the last commit`,
      original: versions.head ?? '',
      modified: mine,
      controls: { accept: 'Keep', reject: 'Revert' },
      saveExplicitly: false,
    };
  }
  if (req.with === 'merge') {
    const sides = splitConflicts(mine);
    if (!sides) throw new CompareError('This file has no merge conflicts.');
    const ours = sides.oursLabel || 'ours';
    const theirs = sides.theirsLabel || 'theirs';
    // Starts from our side; each conflict shows theirs to take instead.
    return {
      title: `${name}: ${sides.count} ${sides.count === 1 ? 'conflict' : 'conflicts'}`,
      original: sides.theirs,
      modified: sides.ours,
      controls: { accept: `Keep ${ours}`, reject: `Use ${theirs}` },
      saveExplicitly: true,
    };
  }
  const other = req.with.file;
  return {
    title: `${name} ↔ ${basename(other)}`,
    original: await workspace.readFile(project, other),
    modified: mine,
    controls: { accept: 'Keep', reject: `Use ${basename(other)}` },
    saveExplicitly: false,
  };
}
