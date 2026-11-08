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
  | 'yaml'
  | 'toml'
  | 'dockerfile'
  | 'ini'
  | 'env'
  | 'shell'
  | 'powershell'
  | 'makefile'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'objectivec'
  | 'csharp'
  | 'kotlin'
  | 'swift'
  | 'dart'
  | 'xml'
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
  // The first problem on a line shown at its end. Missing means on.
  errorLens?: boolean;
  // VoiceOver / TalkBack is running: the editor announces the line and its problems.
  screenReader?: boolean;
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

// Touch gestures in the editor, each switchable in Settings > Gestures. They
// are all off while a screen reader is running.
export interface EditorGestures {
  // Two-finger horizontal swipe: next / previous tab.
  tabs: boolean;
  // Pinch: code font size.
  pinch: boolean;
  // Three-finger horizontal swipe: left undoes, right redoes.
  undo: boolean;
  // Pull down at the top of the file: command palette.
  pullPalette: boolean;
  // Two-finger tap: editor actions.
  twoFingerTap: boolean;
}

export const GESTURE_KEYS = ['tabs', 'pinch', 'undo', 'pullPalette', 'twoFingerTap'] as const satisfies readonly (keyof EditorGestures)[];
export const ALL_GESTURES: EditorGestures = { tabs: true, pinch: true, undo: true, pullPalette: true, twoFingerTap: true };
export const NO_GESTURES: EditorGestures = { tabs: false, pinch: false, undo: false, pullPalette: false, twoFingerTap: false };

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

// What Peek definition shows: `text` is a few lines around the definition,
// starting at `startLine`; `line` is the definition's own line. All 1-based.
export type PeekTarget = { path: string; line: number; text: string; startLine: number };
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
  | { type: 'complete' }
  // Peek definition at the cursor: the editor answers with a 'peek' message.
  | { type: 'peek' }
  // The answer to a 'peek' message from `path` at `offset`; null when nothing was found.
  | { type: 'showPeek'; path: string; offset: number; target: PeekTarget | null }
  // Moves the cursor to the next (1) or previous (-1) problem and announces it.
  | { type: 'gotoProblem'; direction: 1 | -1 }
  // Which touch gestures are on (all off while a screen reader runs).
  | { type: 'setGestures'; gestures: EditorGestures }
  // "✦ Fix" in the error lens: on when AI is set up and the app handles 'fixProblem'.
  | { type: 'setAiFix'; enabled: boolean }
  // AI inline completions (ghost text): on or off, and the model's id for the hint.
  | { type: 'setCompletions'; enabled: boolean; model?: string }
  // The answer to a 'requestCompletion'; '' means nothing to show.
  | { type: 'completion'; requestId: number; text: string }
  // The key bar's Accept / Word, Dismiss and Next.
  | { type: 'acceptCompletion'; part: 'all' | 'word' }
  | { type: 'dismissCompletion' }
  | { type: 'nextCompletion' }
  // Send any typing still waiting on the change debounce now, then answer 'flushed'.
  | { type: 'flush'; id: number }
  // Sends pending typing, then shows an empty read-only document and drops
  // focus, so nothing typed afterwards edits the file that was open. The
  // next 'open' brings an editable document back.
  | { type: 'close' };

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
  | { type: 'serviceDiagnostics'; path: string; items: EditorDiagnostic[] }
  // ⌥F12 or a 'peek' message: Peek definition at `offset`.
  | { type: 'peek'; path: string; offset: number }
  // "Open" in a peek: go to a 1-based line in a file, which may not be open.
  | { type: 'openAt'; path: string; line: number }
  // Something for VoiceOver / TalkBack to say, e.g. after Next problem.
  | { type: 'announce'; text: string }
  // A two-finger tap in the editor: show the editor actions.
  | { type: 'actions' }
  // "✦ Fix" tapped in the error lens of a 1-based line.
  | { type: 'fixProblem'; path: string; line: number }
  // Typing paused: an inline completion for the text around the cursor,
  // capped to a few thousand characters before and after it.
  | { type: 'requestCompletion'; requestId: number; path: string; prefix: string; suffix: string }
  // Ghost text appeared or went away.
  | { type: 'completionState'; visible: boolean }
  // Answers 'flush', after the 'change' it sent (if there was typing pending).
  | { type: 'flushed'; id: number };

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
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  dockerfile: 'dockerfile',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  env: 'env',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  mk: 'makefile',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  m: 'objectivec',
  mm: 'objectivec',
  cs: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  xml: 'xml',
  plist: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  xaml: 'xml',
  csproj: 'xml',
  svg: 'xml',
};

// Config files that are JSON without a .json extension.
const JSON_NAMES = new Set(['.prettierrc', '.eslintrc', '.babelrc', '.swcrc', '.jshintrc']);

// Files known by their whole name (compared lowercased).
const NAMES: Record<string, Language> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.bash_aliases': 'shell',
  '.zshrc': 'shell',
  '.zprofile': 'shell',
  '.zshenv': 'shell',
  '.profile': 'shell',
  '.env': 'env',
  '.editorconfig': 'ini',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
};

export function languageFor(path: string): Language {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (JSON_NAMES.has(name)) return 'json';
  const lower = name.toLowerCase();
  const named = NAMES[lower];
  if (named) return named;
  // .env.local, .env.production...
  if (lower.startsWith('.env.')) return 'env';
  // Dockerfile.dev, Containerfile.prod...
  if (/^(docker|container)file\./.test(lower)) return 'dockerfile';
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
  'peek',
  'showPeek',
  'gotoProblem',
  'setGestures',
  'setAiFix',
  'setCompletions',
  'completion',
  'acceptCompletion',
  'dismissCompletion',
  'nextCompletion',
  'flush',
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
  'peek',
  'openAt',
  'announce',
  'actions',
  'fixProblem',
  'requestCompletion',
  'completionState',
  'flushed',
]);

// Extra checks for messages whose fields pick a code path in the WebView; an
// unknown font id would otherwise leave the editor with a fallback font.
const VALID: Partial<Record<string, (msg: Record<string, unknown>) => boolean>> = {
  setFont: (msg) => isCodeFont(msg.font) && typeof msg.ligatures === 'boolean',
  setAiFix: (msg) => typeof msg.enabled === 'boolean',
  fixProblem: (msg) => typeof msg.path === 'string' && Number.isInteger(msg.line) && (msg.line as number) > 0,
  setCompletions: (msg) => typeof msg.enabled === 'boolean' && (msg.model === undefined || typeof msg.model === 'string'),
  completion: (msg) => Number.isInteger(msg.requestId) && typeof msg.text === 'string',
  acceptCompletion: (msg) => msg.part === 'all' || msg.part === 'word',
  requestCompletion: (msg) =>
    Number.isInteger(msg.requestId) && typeof msg.path === 'string' && typeof msg.prefix === 'string' && typeof msg.suffix === 'string',
  completionState: (msg) => typeof msg.visible === 'boolean',
  flush: (msg) => Number.isInteger(msg.id),
  flushed: (msg) => Number.isInteger(msg.id),
  setGestures: (msg) =>
    typeof msg.gestures === 'object' && msg.gestures !== null && GESTURE_KEYS.every((k) => typeof (msg.gestures as Record<string, unknown>)[k] === 'boolean'),
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
