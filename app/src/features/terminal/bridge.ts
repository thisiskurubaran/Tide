// Messages between the app and the xterm.js WebView. Plain TypeScript, shared
// with the web bundle. The terminal only renders and collects keystrokes; the
// shell runs on the React Native side.
import type { TerminalTheme } from '../../theme/terminal';
import type { Shortcut } from '../project/shortcuts';

export type ToTerminal =
  | { type: 'write'; data: string }
  | { type: 'setTheme'; theme: TerminalTheme; fontSize: number }
  | { type: 'focus' }
  | { type: 'blur' }
  // Finds text in the output and scrollback, from the current match.
  | { type: 'find'; query: string; backwards: boolean; caseSensitive: boolean }
  | { type: 'clearFind' };

export type FromTerminal =
  | { type: 'ready'; cols: number; rows: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'focus'; focused: boolean }
  | { type: 'link'; url: string }
  | { type: 'shortcut'; id: Shortcut }
  // A pinch changed the font size.
  | { type: 'zoom'; fontSize: number }
  // Search results: `index` is -1 when there are too many to number.
  | { type: 'found'; index: number; count: number };

const TO = new Set<ToTerminal['type']>(['write', 'setTheme', 'focus', 'blur', 'find', 'clearFind']);
const FROM = new Set<FromTerminal['type']>(['ready', 'input', 'resize', 'focus', 'link', 'shortcut', 'zoom', 'found']);

function parse<T extends { type: string }>(raw: string, types: Set<string>): T | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (typeof msg === 'object' && msg !== null && types.has((msg as { type?: unknown }).type as string)) {
      return msg as T;
    }
  } catch {
    // Not one of ours; ignore it.
  }
  return null;
}

export const parseToTerminal = (raw: string) => parse<ToTerminal>(raw, TO);
export const parseFromTerminal = (raw: string) => parse<FromTerminal>(raw, FROM);
