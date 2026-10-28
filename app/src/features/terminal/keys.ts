// Ctrl+key from a hardware keyboard as the control character a terminal
// expects. xterm.js derives these from KeyboardEvent.keyCode, which WebKit on
// iOS doesn't always fill in for hardware keyboards, so Ctrl-C did nothing.
// Plain TypeScript: the terminal web bundle imports it.
const SYMBOLS: Record<string, string> = {
  '@': '\x00',
  ' ': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  _: '\x1f',
  '?': '\x7f',
};

export function controlChar(e: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  // `code` names the physical key, so it still works when `key` comes through as a control character.
  const letter = /^Key([A-Z])$/.exec(e.code ?? '')?.[1] ?? (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : null);
  if (letter) return String.fromCharCode(letter.charCodeAt(0) - 64);
  return SYMBOLS[e.key] ?? null;
}
