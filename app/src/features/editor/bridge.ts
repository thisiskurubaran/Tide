// Messages between the app and the CodeMirror WebView. Plain TypeScript with
// no React Native imports, because the web bundle compiles this file too.
import type { EditorTheme } from '../../theme/editor';
import type { Shortcut } from '../project/shortcuts';

export type Language = 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'python' | 'json' | 'html' | 'css' | 'markdown' | 'plain';

export type EditorKey = 'left' | 'right' | 'up' | 'down' | 'tab';

// Editor behavior that paid extensions switch on. The code is always in the
// bundle; these flags only enable it.
export interface EditorFeatures {
  // Completions, hover and go to definition answered by the app (IntelliSense Pro).
  language: boolean;
  // Gutter breakpoints and the paused-line highlight (Debugger).
  breakpoints: boolean;
  // Accept current / incoming / both on merge conflict markers (Git Pro).
  conflicts: boolean;
}

// View options from Settings, free for everyone.
export interface EditorOptions {
  wordWrap: boolean;
  folding: boolean;
  indentGuides: boolean;
  minimap: boolean;
}

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
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'find' }
  // 1-based; ignored unless `path` is the open file.
  | { type: 'goto'; path: string; line: number; column?: number }
  | { type: 'insert'; text: string }
  | { type: 'key'; key: EditorKey }
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
  | { type: 'error'; message: string }
  | ({ type: 'request' } & EditorRequest)
  // F12, or Cmd/Ctrl-click on a symbol.
  | { type: 'definition'; path: string; offset: number }
  // The cursor moved; commands like rename act on it.
  | { type: 'cursor'; path: string; offset: number }
  // Breakpoints in a file after a gutter tap, or after edits moved them. 1-based.
  | { type: 'breakpointsChanged'; path: string; lines: number[] };

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
  html: 'html',
  htm: 'html',
  css: 'css',
  md: 'markdown',
  markdown: 'markdown',
};

export function languageFor(path: string): Language {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'plain';
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? 'plain';
}

const TO_EDITOR = new Set<ToEditor['type']>([
  'open',
  'setTheme',
  'undo',
  'redo',
  'find',
  'goto',
  'insert',
  'key',
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
]);
const FROM_EDITOR = new Set<FromEditor['type']>([
  'ready',
  'change',
  'save',
  'focus',
  'shortcut',
  'error',
  'request',
  'definition',
  'cursor',
  'breakpointsChanged',
]);

function parse<T extends { type: string }>(raw: string, types: Set<string>): T | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (typeof msg === 'object' && msg !== null && types.has((msg as { type?: unknown }).type as string)) {
      return msg as T;
    }
  } catch {
    // Not one of ours (e.g. a stray postMessage); ignore it.
  }
  return null;
}

export const parseToEditor = (raw: string) => parse<ToEditor>(raw, TO_EDITOR);
export const parseFromEditor = (raw: string) => parse<FromEditor>(raw, FROM_EDITOR);
