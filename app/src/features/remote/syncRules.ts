import type { AllSyncSkipDirs, SyncLimits, SyncSkipDir } from '@shared/protocol';

// Runtime copy of the sync rules in shared/protocol.ts (tsc checks they match;
// server/src/syncRules.ts is the server's copy).
export const SYNC_MAX_BYTES: SyncLimits['maxBytes'] = 2097152;

const DIRS = [
  'node_modules',
  '.git',
  '__pycache__',
  '.pylibs',
  '.venv',
  'venv',
  '.cache',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.angular',
  '.expo',
  '.gradle',
  '.dart_tool',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nyc_output',
  'coverage',
  'target',
] as const satisfies readonly SyncSkipDir[];
export const SYNC_SKIP_DIRS: ReadonlySet<string> = new Set<string>(DIRS satisfies AllSyncSkipDirs<typeof DIRS>);

// True when `path` (relative, '/'-separated) is inside a skipped folder.
export function isSyncSkipped(path: string): boolean {
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i++) if (SYNC_SKIP_DIRS.has(parts[i])) return true;
  return false;
}
