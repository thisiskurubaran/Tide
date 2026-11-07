import type { SshCommand } from './store';

// Typed into the terminal as if entered by hand. Several lines run one after
// another; a trailing newline is added so the last one runs too.
export const commandInput = (c: SshCommand) => `${c.command.replace(/\r?\n/g, '\r').replace(/\r+$/, '')}\r`;

export const STARTER_COMMANDS: SshCommand[] = [
  { name: 'Disk space', command: 'df -h' },
  { name: 'Memory', command: 'free -h' },
  { name: 'Top processes', command: 'ps aux --sort=-%cpu | head -15' },
  { name: 'Follow system log', command: 'journalctl -f -n 50' },
];

export function upsertCommand(list: SshCommand[], index: number | null, next: SshCommand): SshCommand[] {
  const command = { name: next.name.trim(), command: next.command.trim() };
  if (!command.name || !command.command) throw new Error('A command needs a name and something to run.');
  return index === null ? [...list, command] : list.map((c, i) => (i === index ? command : c));
}

export function moveCommand(list: SshCommand[], from: number, by: -1 | 1): SshCommand[] {
  const to = from + by;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}
