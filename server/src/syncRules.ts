import type { AllSyncRootSkipDirs, AllSyncSkipDirs, SyncLimits, SyncRootSkipDir, SyncSkipDir } from '../../shared/protocol.ts';

// Runtime copy of the sync rules in shared/protocol.ts (tsc checks they match).
export const SYNC_MAX_BYTES: SyncLimits['maxBytes'] = 2097152;

// Skipped at any depth.
const DIRS = [
  'node_modules',
  '.git',
  '__pycache__',
  '.pylibs',
  '.venv',
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
] as const satisfies readonly SyncSkipDir[];
export const SYNC_SKIP_DIRS: ReadonlySet<string> = new Set<string>(DIRS satisfies AllSyncSkipDirs<typeof DIRS>);

// Skipped only as a top-level folder of the project (src/coverage/ syncs).
const ROOT_DIRS = ['venv', '.cache', 'coverage', 'target'] as const satisfies readonly SyncRootSkipDir[];
export const SYNC_ROOT_SKIP_DIRS: ReadonlySet<string> = new Set<string>(ROOT_DIRS satisfies AllSyncRootSkipDirs<typeof ROOT_DIRS>);

// True when `path` (relative, '/'-separated) is inside a skipped folder.
export function isSyncSkipped(path: string): boolean {
  const parts = path.split('/');
  if (parts.length > 1 && SYNC_ROOT_SKIP_DIRS.has(parts[0])) return true;
  for (let i = 0; i < parts.length - 1; i++) if (SYNC_SKIP_DIRS.has(parts[i])) return true;
  return false;
}
