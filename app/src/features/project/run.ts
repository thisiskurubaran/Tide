import type { RunnerMode } from '../../state/runner';

// What Cmd-R types into the terminal. The local shell has `run`, which reads
// tide.json itself; the remote one is plain bash, so the entry is spelled out.
export function runLine(mode: RunnerMode, tideJson: string | null): string | null {
  if (mode === 'local') return 'run\r';
  let config: { runtime?: string; entry?: string } = {};
  try {
    config = JSON.parse(tideJson ?? '{}');
  } catch {
    return null;
  }
  if (!config.entry) return null;
  const entry = /^[\w./-]+$/.test(config.entry) ? config.entry : `'${config.entry.replace(/'/g, `'\\''`)}'`;
  return config.runtime === 'python' ? `python3 ${entry}\r` : `node ${entry}\r`;
}
