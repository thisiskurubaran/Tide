// Keys the editor and terminal key bars can show. A bar is a list of key ids:
// a built-in id from these catalogs, or 'text:<chars>' for any text, which
// is how users add their own symbols and snippets. No React Native imports,
// so tests and settings screens share it.
import type { Language } from '../editor/bridge';

export type EditorAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'tab'
  | 'undo'
  | 'redo'
  | 'find'
  | 'complete'
  | 'select-word'
  | 'select-line'
  | 'expand'
  | 'select-all'
  | 'copy'
  | 'cut';

// Keys the bars handle themselves rather than map to a message or bytes.
export const TRACKPAD = 'trackpad';
export const SELECT_MODE = 'select';
export const PASTE = 'paste';

export interface CatalogKey {
  id: string;
  // Shown on the key; icon is a Feather name and wins over label.
  label?: string;
  icon?: string;
  a11y: string;
}

export const EDITOR_KEYS: CatalogKey[] = [
  { id: TRACKPAD, icon: 'move', a11y: 'Cursor trackpad' },
  { id: SELECT_MODE, label: 'sel', a11y: 'Select mode' },
  { id: 'left', icon: 'arrow-left', a11y: 'Cursor left' },
  { id: 'up', icon: 'arrow-up', a11y: 'Cursor up' },
  { id: 'down', icon: 'arrow-down', a11y: 'Cursor down' },
  { id: 'right', icon: 'arrow-right', a11y: 'Cursor right' },
  { id: 'home', label: '⇤', a11y: 'Start of line' },
  { id: 'end', label: '⇥|', a11y: 'End of line' },
  { id: 'tab', label: '⇥', a11y: 'Tab' },
  { id: 'select-word', label: 'word', a11y: 'Select word' },
  { id: 'select-line', label: 'line', a11y: 'Select line' },
  { id: 'expand', icon: 'maximize-2', a11y: 'Expand selection' },
  { id: 'select-all', label: 'all', a11y: 'Select all' },
  { id: 'copy', icon: 'copy', a11y: 'Copy' },
  { id: 'cut', icon: 'scissors', a11y: 'Cut' },
  { id: PASTE, icon: 'clipboard', a11y: 'Paste' },
  { id: 'undo', icon: 'corner-up-left', a11y: 'Undo' },
  { id: 'redo', icon: 'corner-up-right', a11y: 'Redo' },
  { id: 'find', icon: 'search', a11y: 'Find' },
  { id: 'complete', icon: 'list', a11y: 'Show suggestions' },
];

// Bytes a hardware keyboard would send for each key.
const ESC = '\x1b';
// Data is empty for keys the terminal bar handles itself.
export const TERMINAL_KEYS: (CatalogKey & { data: string })[] = [
  { id: TRACKPAD, icon: 'move', a11y: 'Cursor trackpad', data: '' },
  { id: PASTE, icon: 'clipboard', a11y: 'Paste', data: '' },
  { id: 'esc', label: 'esc', a11y: 'Escape', data: ESC },
  { id: 'tab', label: '⇥', a11y: 'Tab', data: '\t' },
  { id: 'ctrl-c', label: '^C', a11y: 'Control C', data: '\x03' },
  { id: 'ctrl-d', label: '^D', a11y: 'Control D', data: '\x04' },
  { id: 'ctrl-z', label: '^Z', a11y: 'Control Z', data: '\x1a' },
  { id: 'ctrl-l', label: '^L', a11y: 'Clear screen', data: '\x0c' },
  { id: 'ctrl-r', label: '^R', a11y: 'Search history', data: '\x12' },
  { id: 'ctrl-a', label: '^A', a11y: 'Start of line', data: '\x01' },
  { id: 'ctrl-e', label: '^E', a11y: 'End of line', data: '\x05' },
  { id: 'left', icon: 'arrow-left', a11y: 'Cursor left', data: `${ESC}[D` },
  { id: 'up', icon: 'arrow-up', a11y: 'Previous command', data: `${ESC}[A` },
  { id: 'down', icon: 'arrow-down', a11y: 'Next command', data: `${ESC}[B` },
  { id: 'right', icon: 'arrow-right', a11y: 'Cursor right', data: `${ESC}[C` },
  { id: 'home', label: 'home', a11y: 'Home', data: `${ESC}[H` },
  { id: 'end', label: 'end', a11y: 'End', data: `${ESC}[F` },
  { id: 'pgup', label: 'pg↑', a11y: 'Page up', data: `${ESC}[5~` },
  { id: 'pgdn', label: 'pg↓', a11y: 'Page down', data: `${ESC}[6~` },
];

export const text = (chars: string) => `text:${chars}`;

// Names for symbols, so VoiceOver reads more than "punctuation".
const SYMBOL_NAMES: Record<string, string> = {
  '{': 'Open brace',
  '}': 'Close brace',
  '(': 'Open parenthesis',
  ')': 'Close parenthesis',
  '[': 'Open bracket',
  ']': 'Close bracket',
  ';': 'Semicolon',
  ':': 'Colon',
  '"': 'Double quote',
  "'": 'Single quote',
  '`': 'Backtick',
  '=': 'Equals',
  '<': 'Less than',
  '>': 'Greater than',
  '/': 'Slash',
  '\\': 'Backslash',
  '-': 'Dash',
  '_': 'Underscore',
  '~': 'Tilde',
  '.': 'Dot',
  '|': 'Pipe',
  '*': 'Star',
  '#': 'Hash',
  '$': 'Dollar',
  '&': 'Ampersand',
  '!': 'Exclamation mark',
  '@': 'At sign',
  '%': 'Percent',
  '+': 'Plus',
  '?': 'Question mark',
  '()': 'Parentheses',
  '{}': 'Braces',
  '[]': 'Brackets',
  '<>': 'Angle brackets',
  '""': 'Double quotes',
  "''": 'Single quotes',
  '``': 'Backticks',
  '=>': 'Arrow',
  '==': 'Equals equals',
  '===': 'Triple equals',
  '!=': 'Not equals',
  '<=': 'Less than or equal',
  '</': 'Closing tag',
  '//': 'Line comment',
  '/*  */': 'Block comment',
  ':=': 'Colon equals',
  '::': 'Double colon',
  '->': 'Thin arrow',
  '&&': 'And and',
  '||': 'Or or',
  '$()': 'Command substitution',
};

// What holding a symbol key offers. `cursor` puts the caret inside a pair,
// counted from the start; without it the caret goes after the text.
export interface SymbolVariant {
  text: string;
  cursor?: number;
}

const pair = (text: string): SymbolVariant => ({ text, cursor: text.length / 2 });
const plain = (...texts: string[]) => texts.map((t): SymbolVariant => ({ text: t }));

export const KEY_VARIANTS: Record<string, SymbolVariant[]> = {
  '(': [pair('()'), ...plain('(', ')', '=>')],
  '{': [pair('{}'), ...plain('{', '}')],
  '[': [pair('[]'), ...plain('[', ']')],
  '"': [pair('""'), ...plain("'", '`')],
  "'": [pair("''"), ...plain('"', '`')],
  '`': [pair('``'), ...plain("'", '"')],
  '<': [pair('<>'), ...plain('</', '<=')],
  '=': plain('==', '===', '!=', '=>'),
  '/': [...plain('//'), { text: '/*  */', cursor: 3 }, ...plain('\\')],
  ';': plain(':', ';'),
};

export const symbolName = (chars: string) => SYMBOL_NAMES[chars] ?? `Type ${chars}`;

const chars = (s: string) => [...s].map(text);

const EDIT = ['undo', 'redo', 'find', 'expand', 'copy', PASTE];

export const DEFAULT_EDITOR_KEYS = [TRACKPAD, SELECT_MODE, 'left', 'up', 'down', 'right', 'tab', ...chars('{}()[];:"\'=<>/\\'), ...EDIT];
export const DEFAULT_TERMINAL_KEYS = [TRACKPAD, 'esc', 'tab', 'ctrl-c', 'ctrl-l', 'left', 'up', 'down', 'right', ...chars('/-~.|>"\'*_'), PASTE];

const NAV = [TRACKPAD, SELECT_MODE, 'left', 'up', 'down', 'right', 'tab'];

// Starting points per language; users can change them in Settings.
export const LANGUAGE_PRESETS: Partial<Record<Language, string[]>> = {
  python: [TRACKPAD, SELECT_MODE, 'left', 'up', 'down', 'right', 'tab', ...chars(':()[]{}=_\'".#'), text('self.'), ...EDIT],
  javascript: [TRACKPAD, SELECT_MODE, 'left', 'up', 'down', 'right', 'tab', ...chars('{}()[];=<>\'"`'), text('=>'), text('const '), ...EDIT],
  html: [TRACKPAD, SELECT_MODE, 'left', 'up', 'down', 'right', 'tab', ...chars('<>/="\''), text('</'), ...EDIT],
  go: [...NAV, ...chars('{}()[]:=.*&"`'), text(':='), ...EDIT],
  rust: [...NAV, ...chars("{}()[];:&<>'\"!"), text('::'), text('->'), text('let '), ...EDIT],
  c: [...NAV, ...chars('{}()[];*&<>"#'), text('->'), ...EDIT],
  cpp: [...NAV, ...chars('{}()[];*&<>"#'), text('->'), text('::'), ...EDIT],
  java: [...NAV, ...chars('{}()[];.<>="@'), text('->'), ...EDIT],
  csharp: [...NAV, ...chars('{}()[];.<>="'), text('=>'), ...EDIT],
  kotlin: [...NAV, ...chars('{}()[]:.<>="?'), text('->'), text('val '), ...EDIT],
  swift: [...NAV, ...chars('{}()[]:.<>="?!'), text('->'), text('let '), ...EDIT],
  dart: [...NAV, ...chars('{}()[];.<>="\''), text('=>'), ...EDIT],
  shell: [...NAV, ...chars('$|>&"\'{}[]-#'), text('&&'), text('$()'), ...EDIT],
  powershell: [...NAV, ...chars('$|{}()[]-"\'@'), ...EDIT],
  makefile: [...NAV, ...chars(':=$()@%#'), ...EDIT],
  yaml: [...NAV, ...chars(':-"\'#|>[]{}&*'), ...EDIT],
  toml: [...NAV, ...chars('[]="\'.#{}'), ...EDIT],
  xml: [TRACKPAD, SELECT_MODE, 'left', 'up', 'down', 'right', 'tab', ...chars('<>/="\''), text('</'), ...EDIT],
};

export interface KeyFace {
  id: string;
  label?: string;
  icon?: string;
  a11y: string;
}

// How a key id looks; unknown ids (from a newer version) come back null and are skipped.
export function keyFace(id: string, bar: 'editor' | 'terminal'): KeyFace | null {
  if (id.startsWith('text:')) {
    const value = id.slice(5);
    if (!value) return null;
    return { id, label: value.length > 8 ? `${value.slice(0, 7)}…` : value, a11y: symbolName(value) };
  }
  const found = (bar === 'editor' ? EDITOR_KEYS : TERMINAL_KEYS).find((k) => k.id === id);
  return found ? { id, label: found.label, icon: found.icon, a11y: found.a11y } : null;
}

export const terminalData = (id: string): string | null =>
  id.startsWith('text:') ? id.slice(5) : (TERMINAL_KEYS.find((k) => k.id === id)?.data || null);

export const ARROW_BYTES = { left: `${ESC}[D`, right: `${ESC}[C`, up: `${ESC}[A`, down: `${ESC}[B` } as const;
