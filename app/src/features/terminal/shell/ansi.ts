// Colors are ANSI indexes, so they follow the terminal theme (theme/terminal.ts).
export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  clearLine: '\x1b[K',
  clearScreen: '\x1b[2J\x1b[3J\x1b[H',
  left: (n: number) => (n > 0 ? `\x1b[${n}D` : ''),
};

// Visible width, ignoring color codes. Wide characters are counted as one column.
export function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
}
