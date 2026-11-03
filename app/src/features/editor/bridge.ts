// Messages between the app and the CodeMirror WebView. Plain TypeScript with
// no React Native imports, because the web bundle compiles this file too.
import type { EditorTheme } from '../../theme/editor';
import type { Shortcut } from '../project/shortcuts';

export type Language =
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'python'
  | 'json'
  | 'html'
  | 'css'
  | 'scss'
  | 'less'
  | 'markdown'
  | 'lua'
  | 'ruby'
  | 'php'
  | 'sql'
  | 'plain';

export type EditorKey = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'tab';

export type SelectUnit = 'word' | 'line' | 'all' | 'expand';

// Editor behavior that paid extensions switch on. The code is always in the
// bundle; these flags only enable it.
export interface EditorFeatures {
  // Completions, hover and go to definition answered by the app (IntelliSense).
  language: boolean;
  // Gutter breakpoints and the paused-line highlight (Debugger).
  breakpoints: boolean;
  // Accept current / incoming / both on merge conflict markers (Git Tools).
  conflicts: boolean;
}

export type KeymapSetting = 'standard' | 'vim' | 'emacs';

// A user snippet: typing `prefix` offers `body`, in VS Code syntax ($1, ${2:name}, $0).
// No languages means every language.
export interface Snippet {
  prefix: string;
  body: string;
  description?: string;
  languages?: Language[];
}

// View options from Settings, free for everyone.
export interface EditorOptions {
  wordWrap: boolean;
  folding: boolean;
  indentGuides: boolean;
  minimap: boolean;
  keymap: KeymapSetting;
  emmet?: boolean;
  snippets?: Snippet[];
}

// Code fonts bundled in assets/fonts (Regular only). The id is what Settings
// stores; `family` is the CSS name the WebViews register; `postScript` is the
// name React Native resolves (it matches the .ttf file name).
export type CodeFont = 'jetbrains-mono' | 'fira-code' | 'ibm-plex-mono' | 'source-code-pro';

export const CODE_FONTS: Record<CodeFont, { name: string; family: string; postScript: string }> = {
  'jetbrains-mono': { name: 'JetBrains Mono', family: 'JetBrains Mono', postScript: 'JetBrainsMono-Regular' },
  'fira-code': { name: 'Fira Code', family: 'Fira Code', postScript: 'FiraCode-Regular' },
  'ibm-plex-mono': { name: 'IBM Plex Mono', family: 'IBM Plex Mono', postScript: 'IBMPlexMono-Regular' },
  'source-code-pro': { name: 'Source Code Pro', family: 'Source Code Pro', postScript: 'SourceCodePro-Regular' },
};

export const DEFAULT_CODE_FONT: CodeFont = 'jetbrains-mono';

export const isCodeFont = (v: unknown): v is CodeFont => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CODE_FONTS, v);

export const NO_FEATURES: EditorFeatures = { language: false, breakpoints: false, conflicts: false };

export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
}

export interface CompletionItem {
  label: string;
  // CodeMirror completion type, used for the icon: function, variable, class, keyword...
  type?: string;
  detail?: string;
}

export type CompletionResult = { from: number; items: CompletionItem[] };
export type HoverResult = { text: string; from: number; to: number };

export type EditorRequest =
  | { id: number; method: 'completion'; path: string; offset: number; explicit: boolean }
  | { id: number; method: 'hover'; path: string; offset: number };

export type ToEditor =
  | { type: 'open'; path: string; content: string; language: Language }
  | { type: 'setTheme'; theme: EditorTheme; dark: boolean; fontSize: number }
  // Code font and programming ligatures (=> != >=) for the editor text.
  | { type: 'setFont'; font: CodeFont; ligatures: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'find' }
  // 1-based; ignored unless `path` is the open file.
  | { type: 'goto'; path: string; line: number; column?: number }
  | { type: 'insert'; text: string }
  // `select` extends the selection instead of moving the cursor.
  | { type: 'key'; key: EditorKey; select?: boolean }
  // A swipe across the key bar: `by` characters, negative is left.
  | { type: 'moveCursor'; by: number; select?: boolean }
  // Typed as is, without auto-close; the caret lands `cursor` characters in
  // (default: the end), and a pair with the caret inside wraps the selection.
  | { type: 'insertLiteral'; text: string; cursor?: number }
  | { type: 'select'; unit: SelectUnit }
  // Answered with a 'clipboard' message; cut also deletes the selection.
  | { type: 'copy'; cut: boolean }
  | { type: 'focus' }
  // Keyboard.dismiss() only blurs RN text inputs, so the WebView is asked directly.
  | { type: 'blur' }
  | { type: 'features'; features: EditorFeatures }
  | { type: 'options'; options: EditorOptions }
  // Text changed outside the editor (format, git discard, the shell). Applied
  // as an edit, so undo history and the cursor survive.
  // `base` is the text the change was made from; if the editor has moved on, it is skipped.
  | { type: 'setContent'; path: string; content: string; base?: string }
  | { type: 'diagnostics'; path: string; items: EditorDiagnostic[] }
  | { type: 'response'; id: number; result: CompletionResult | HoverResult | null }
  // 1-based line numbers.
  | { type: 'breakpoints'; path: string; lines: number[] }
  // Where the debugger is paused, or null when it isn't.
  | { type: 'execLine'; path: string | null; line: number }
  // Opens the completion list (the accessory bar has no Ctrl-Space).
  | { type: 'complete' };

export type FromEditor =
  | { type: 'ready' }
  // Sent on every edit; `path` lets the app ignore late events from a file it already switched away from.
  | { type: 'change'; path: string; content: string }
  // Cmd/Ctrl-S from a hardware keyboard.
  | { type: 'save'; path: string }
  | { type: 'focus'; focused: boolean }
  | { type: 'shortcut'; id: Shortcut }
  // Text to put on the system clipboard, after a 'copy' message.
  | { type: 'clipboard'; text: string }
  // A pinch changed the font size.
  | { type: 'zoom'; fontSize: number }
  | { type: 'error'; message: string }
  | ({ type: 'request' } & EditorRequest)
  // F12, or Cmd/Ctrl-click on a symbol.
  | { type: 'definition'; path: string; offset: number }
  // The cursor moved; commands like rename act on it.
  | { type: 'cursor'; path: string; offset: number }
  // Breakpoints in a file after a gutter tap, or after edits moved them. 1-based.
  | { type: 'breakpointsChanged'; path: string; lines: number[] }
  // What the built-in CSS/HTML/JSON services found in a file, for the Problems panel.
  | { type: 'serviceDiagnostics'; path: string; items: EditorDiagnostic[] };

const EXTENSIONS: Record<string, Language> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  lua: 'lua',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
};

// Config files that are JSON without a .json extension.
const JSON_NAMES = new Set(['.prettierrc', '.eslintrc', '.babelrc', '.swcrc', '.jshintrc']);

export function languageFor(path: string): Language {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (JSON_NAMES.has(name)) return 'json';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'plain';
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? 'plain';
}

const TO_EDITOR = new Set<ToEditor['type']>([
  'open',
  'setTheme',
  'setFont',
  'undo',
  'redo',
  'find',
  'goto',
  'insert',
  'key',
  'moveCursor',
  'insertLiteral',
  'focus',
  'blur',
  'features',
  'options',
  'setContent',
  'diagnostics',
  'response',
  'breakpoints',
  'execLine',
  'complete',
  'select',
  'copy',
]);
const FROM_EDITOR = new Set<FromEditor['type']>([
  'ready',
  'serviceDiagnostics',
  'change',
  'save',
  'focus',
  'shortcut',
  'error',
  'request',
  'definition',
  'cursor',
  'breakpointsChanged',
  'clipboard',
  'zoom',
]);

// Extra checks for messages whose fields pick a code path in the WebView; an
// unknown font id would otherwise leave the editor with a fallback font.
const VALID: Partial<Record<string, (msg: Record<string, unknown>) => boolean>> = {
  setFont: (msg) => isCodeFont(msg.font) && typeof msg.ligatures === 'boolean',
};

function parse<T extends { type: string }>(raw: string, types: Set<string>): T | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (typeof msg === 'object' && msg !== null && types.has((msg as { type?: unknown }).type as string)) {
      const check = VALID[(msg as { type: string }).type];
      return !check || check(msg as Record<string, unknown>) ? (msg as T) : null;
    }
  } catch {
    // Not one of ours (e.g. a stray postMessage); ignore it.
  }
  return null;
}

export const parseToEditor = (raw: string) => parse<ToEditor>(raw, TO_EDITOR);
export const parseFromEditor = (raw: string) => parse<FromEditor>(raw, FROM_EDITOR);
