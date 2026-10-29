// Run configurations and tasks, from tide.json:
//
//   {
//     "runtime": "node", "entry": "index.js",          // the default run
//     "configurations": [
//       { "name": "Server", "entry": "server.js", "args": ["--port", "3000"] },
//       { "name": "Script", "runtime": "python", "entry": "tools/gen.py" }
//     ],
//     "tasks": [
//       { "name": "Test", "command": "node --test" },
//       { "name": "Lint", "local": "node lint.js", "remote": "npx eslint ." }
//     ]
//   }
//
// ⌘R runs the chosen configuration. Tasks are command lines typed into the
// terminal; `local` and `remote` replace `command` for that terminal mode.
// In remote mode, package.json scripts are offered as tasks as well.
import type { RunnerMode } from '../../state/runner';
import type { Runtime } from '@shared/protocol';

export const DEFAULT_CONFIG = 'Default';

export interface NamedConfig {
  name: string;
  runtime: Runtime;
  entry: string;
  args: string[];
}

export interface Task {
  name: string;
  command?: string;
  local?: string;
  remote?: string;
  // Opens a new terminal tab for it, e.g. for a server that keeps running.
  newTerminal?: boolean;
}

export interface ProjectTasks {
  configs: NamedConfig[];
  tasks: Task[];
  // Why tide.json couldn't be used, to show instead of silently doing nothing.
  error: string | null;
}

const isRuntime = (v: unknown): v is Runtime => v === 'node' || v === 'python';
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

export function parseTasks(tideJson: string | null, packageJson: string | null = null, mode: RunnerMode = 'local'): ProjectTasks {
  const out: ProjectTasks = { configs: [], tasks: [], error: null };
  let config: Record<string, unknown> = {};
  if (tideJson !== null) {
    try {
      config = JSON.parse(tideJson);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('not an object');
    } catch {
      out.error = "tide.json isn't valid JSON";
      config = {};
    }
  }
  const base = { runtime: isRuntime(config.runtime) ? config.runtime : undefined, entry: str(config.entry), args: strings(config.args) };
  if (base.runtime && base.entry) out.configs.push({ name: DEFAULT_CONFIG, runtime: base.runtime, entry: base.entry, args: base.args });
  for (const c of Array.isArray(config.configurations) ? config.configurations : []) {
    const name = str(c?.name);
    const runtime = isRuntime(c?.runtime) ? c.runtime : base.runtime;
    const entry = str(c?.entry);
    if (!name || !runtime || !entry || out.configs.some((x) => x.name === name)) continue;
    out.configs.push({ name, runtime, entry, args: c.args === undefined ? [] : strings(c.args) });
  }
  for (const t of Array.isArray(config.tasks) ? config.tasks : []) {
    const name = str(t?.name);
    if (!name || out.tasks.some((x) => x.name === name)) continue;
    const task: Task = { name, command: str(t.command), local: str(t.local), remote: str(t.remote), newTerminal: t.newTerminal === true };
    if (taskLine(task, mode) !== null) out.tasks.push(task);
  }
  // The local shell has no npm run, so scripts are only offered remotely.
  if (mode === 'remote' && packageJson) {
    try {
      const scripts = JSON.parse(packageJson).scripts;
      for (const name of Object.keys(scripts ?? {})) {
        if (typeof scripts[name] !== 'string' || out.tasks.some((x) => x.name === `npm: ${name}`)) continue;
        out.tasks.push({ name: `npm: ${name}`, remote: `npm run ${quote(name)}`, newTerminal: /^(dev|start|serve|watch)/.test(name) });
      }
    } catch {
      // A broken package.json just has no scripts to offer.
    }
  }
  return out;
}

export const taskLine = (task: Task, mode: RunnerMode): string | null => (mode === 'local' ? task.local : task.remote) ?? task.command ?? null;

const quote = (s: string) => (/^[\w./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// What ⌘R types for a configuration. The local shell's `run` reads tide.json
// itself (by name); remote bash gets the command spelled out.
export function configLine(config: NamedConfig, mode: RunnerMode): string {
  if (mode === 'local') return config.name === DEFAULT_CONFIG ? 'run\r' : `run ${quote(config.name)}\r`;
  const program = config.runtime === 'python' ? 'python3' : 'node';
  return `${[program, config.entry, ...config.args].map(quote).join(' ')}\r`;
}
