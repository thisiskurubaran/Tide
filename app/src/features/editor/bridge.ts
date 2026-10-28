// Messages between the app and the CodeMirror WebView. Plain TypeScript with
// no React Native imports, because the web bundle compiles this file too.
import type { EditorTheme } from '../../theme/editor';
import type { Shortcut } from '../project/shortcuts';

export type Language = 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'python' | 'json' | 'html' | 'css' | 'markdown' | 'plain';

export type EditorKey = 'left' | 'right' | 'up' | 'down' | 'tab';

export type ToEditor =
  | { type: 'open'; path: string; content: string; language: Language }
  | { type: 'setTheme'; theme: EditorTheme; dark: boolean; fontSize: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'find' }
  // 1-based; ignored unless `path` is the open file.
  | { type: 'goto'; path: string; line: number }
  | { type: 'insert'; text: string }
  | { type: 'key'; key: EditorKey }
  | { type: 'focus' }
  // Keyboard.dismiss() only blurs RN text inputs, so the WebView is asked directly.
  | { type: 'blur' };

export type FromEditor =
  | { type: 'ready' }
  // Sent on every edit; `path` lets the app ignore late events from a file it already switched away from.
  | { type: 'change'; path: string; content: string }
  // Cmd/Ctrl-S from a hardware keyboard.
  | { type: 'save'; path: string }
  | { type: 'focus'; focused: boolean }
  | { type: 'shortcut'; id: Shortcut }
  | { type: 'error'; message: string };

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

const TO_EDITOR = new Set<ToEditor['type']>(['open', 'setTheme', 'undo', 'redo', 'find', 'goto', 'insert', 'key', 'focus', 'blur']);
const FROM_EDITOR = new Set<FromEditor['type']>(['ready', 'change', 'save', 'focus', 'shortcut', 'error']);

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
