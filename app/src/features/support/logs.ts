// The app's recent warnings and errors, kept in memory so a bug report can
// include them. Nothing is written to disk or sent anywhere by this.
export interface LogEntry {
  time: number;
  level: 'warn' | 'error';
  message: string;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGE = 2000;
const entries: LogEntry[] = [];

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, MAX_MESSAGE);
}

export function record(level: LogEntry['level'], args: unknown[], now = Date.now()): void {
  entries.push({ time: now, level, message: format(args) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export const recentLogs = (): readonly LogEntry[] => entries;

export function clearLogs(): void {
  entries.length = 0;
}

let installed = false;

// Copies console.warn and console.error into the log, still printing them.
export function captureConsole(): void {
  if (installed) return;
  installed = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  }
}
