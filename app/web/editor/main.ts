import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion } from '@codemirror/autocomplete';
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineDown,
  cursorLineUp,
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  redo,
  selectAll,
  selectCharLeft,
  selectCharRight,
  selectLine,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineDown,
  selectLineUp,
  selectParentSyntax,
  undo,
} from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Extension, Prec } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  rectangularSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

import firaCode from '../../assets/fonts/FiraCode-Regular.ttf';
import ibmPlexMono from '../../assets/fonts/IBMPlexMono-Regular.ttf';
import jetbrainsMono from '../../assets/fonts/JetBrainsMono-Regular.ttf';
import sourceCodePro from '../../assets/fonts/SourceCodePro-Regular.ttf';
import {
  CODE_FONTS,
  CodeFont,
  EditorDiagnostic,
  EditorFeatures,
  EditorGestures,
  EditorKey,
  EditorOptions,
  FromEditor,
  Language,
  NO_FEATURES,
  NO_GESTURES,
  parseToEditor,
  SelectUnit,
  ToEditor,
} from '../../src/features/editor/bridge';
import type { EditorTheme } from '../../src/theme/editor';
import { shortcutFor } from '../../src/features/project/shortcuts';
import { insertLiteral, moveCursor } from './cursor';
import {
  breakpointLines,
  completionSource,
  createRequests,
  execLineEffect,
  featureExtensions,
  lintDiagnostics,
  minimalChange,
  setBreakpoints,
} from './features';
import { attachGestures, createPullPill, PULL_PILL_CSS } from './gestures';
import { languageServices, ServiceHost, serviceCompletions, serviceKind } from './langservices';
import { languageExtension } from './languages';
import { optionsExtension } from './options';
import { snippetSource } from './snippets';
import { a11yExtension, gotoProblem } from './a11y';
import { closePeek, PeekConfig, peekAt, peekExtension, showPeek } from './peek';
import { problemExtensions } from './problems';
import { acceptCompletion as acceptGhost, dismissCompletion, ghostExtension, ghostOf, GhostHost, nextCompletion, setCompletions, setGhostTheme, showCompletion } from './ghost';
import { buildTheme, FONT_FAMILY } from './theme';

const CHANGE_DEBOUNCE_MS = 150;
const CURSOR_DEBOUNCE_MS = 200;

const FONT_FILES: Record<CodeFont, string> = {
  'jetbrains-mono': jetbrainsMono,
  'fira-code': firaCode,
  'ibm-plex-mono': ibmPlexMono,
  'source-code-pro': sourceCodePro,
};
const fontFaces = (Object.keys(FONT_FILES) as CodeFont[])
  .map((id) => `@font-face { font-family: '${CODE_FONTS[id].family}'; src: url(${FONT_FILES[id]}) format('truetype'); }`)
  .join('\n');

const style = document.createElement('style');
style.textContent = `
  ${fontFaces}
  html, body { margin: 0; height: 100%; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
  #editor { height: 100%; }
  .cm-editor { height: 100%; font-size: 14px; }
  .cm-editor.cm-focused { outline: none; }
  :root { --tide-liga: none; --tide-features: "liga" 0, "calt" 0; }
  .cm-scroller { font-family: ${FONT_FAMILY}; line-height: 1.5; }
  /* Ligatures are off by default: in code, => and != usually read better as typed. */
  .cm-content { font-variant-ligatures: var(--tide-liga); font-feature-settings: var(--tide-features); }
`;
document.head.appendChild(style);

function post(msg: FromEditor) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

const languageConf = new Compartment();
const themeConf = new Compartment();
const featureConf = new Compartment();
const optionsConf = new Compartment();
// Gutter shapes and the error lens (problems.ts); the lens is a setting.
const problemsConf = new Compartment();
let themeExtension: Extension = [];
let theme: EditorTheme | null = null;
let features: EditorFeatures = NO_FEATURES;
let options: EditorOptions = { wordWrap: true, folding: true, indentGuides: true, minimap: false, keymap: 'standard' };
let currentLang: Language = 'plain';
const optionExtension = () => optionsExtension(options, theme, currentLang);

let currentPath: string | null = null;
let pendingChange: ReturnType<typeof setTimeout> | null = null;
let pendingCursor: ReturnType<typeof setTimeout> | null = null;

const requests = createRequests(post);
const currentFile = () => currentPath;
const featureExtension = () => featureExtensions(features, currentFile, post, requests.ask);
// "✦ Fix" in the lens, when the app says AI is set up ('setAiFix').
let aiFix = false;
const fixProblem = (line: number) => currentPath !== null && post({ type: 'fixProblem', path: currentPath, line });
const problemExtension = () => problemExtensions({ errorLens: options.errorLens !== false, onFix: aiFix ? fixProblem : null });
const peekConfig: PeekConfig = {
  request: (offset) => currentPath !== null && post({ type: 'peek', path: currentPath, offset }),
  open: (path, line) => post({ type: 'openAt', path, line }),
  theme: () => themeExtension,
};

// Per-file state the app pushes that has to outlive tab switches.
const diagnostics = new Map<string, EditorDiagnostic[]>();
// What the built-in CSS/HTML/JSON services found, shown alongside the app's.
const serviceDiagnostics = new Map<string, EditorDiagnostic[]>();

function showDiagnostics(path: string) {
  if (path !== currentPath) return;
  view.dispatch(lintDiagnostics(view.state, [...(diagnostics.get(path) ?? []), ...(serviceDiagnostics.get(path) ?? [])]));
}

const services: ServiceHost = {
  kind: () => serviceKind(currentLang),
  path: currentFile,
  diagnostics(path, items) {
    const before = serviceDiagnostics.get(path) ?? [];
    if (!items.length && !before.length) return;
    serviceDiagnostics.set(path, items);
    showDiagnostics(path);
    post({ type: 'serviceDiagnostics', path, items });
  },
};
// AI inline completions (ghost.ts).
const ghostHost: GhostHost = { post, path: currentFile };
const breakpointsByPath = new Map<string, number[]>();
let execLine: { path: string; line: number } | null = null;

function flushChange() {
  if (pendingChange === null || currentPath === null) return;
  clearTimeout(pendingChange);
  pendingChange = null;
  post({ type: 'change', path: currentPath, content: view.state.doc.toString() });
}

const saveKeymap = keymap.of([
  {
    key: 'Mod-s',
    preventDefault: true,
    run: () => {
      flushChange();
      if (currentPath) post({ type: 'save', path: currentPath });
      return true;
    },
  },
]);

// App-level shortcuts win over CodeMirror's own (Mod-l would select a line).
// Cmd-S stays with saveKeymap, which flushes the pending change first.
const appShortcuts = Prec.highest(
  EditorView.domEventHandlers({
    keydown(e) {
      const id = shortcutFor(e);
      if (!id || id === 'save') return false;
      e.preventDefault();
      post({ type: 'shortcut', id });
      return true;
    },
  }),
);

function baseExtensions(lang: Language): Extension[] {
  return [
    appShortcuts,
    ghostExtension(ghostHost),
    // Before lineNumbers so the breakpoint gutter sits on the outside.
    featureConf.of(featureExtension()),
    lineNumbers(),
    problemsConf.of(problemExtension()),
    peekExtension(peekConfig),
    a11yExtension(currentFile, () => options.screenReader === true),
    optionsConf.of(optionExtension()),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    // Several cursors: Cmd-click adds one, Option-drag selects a column.
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [
        snippetSource(() => currentLang, () => options.snippets ?? []),
        serviceCompletions(services, completionSource(() => features.language, currentFile, requests.ask)),
      ],
    }),
    languageServices(services),
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
    saveKeymap,
    languageConf.of(languageExtension(lang)),
    themeConf.of(themeExtension),
    EditorView.focusChangeEffect.of((_state, focusing) => {
      post({ type: 'focus', focused: focusing });
      return null;
    }),
    EditorView.updateListener.of((u) => {
      if (currentPath === null) return;
      if (u.selectionSet || u.docChanged) {
        if (pendingCursor !== null) clearTimeout(pendingCursor);
        pendingCursor = setTimeout(() => {
          pendingCursor = null;
          if (currentPath) post({ type: 'cursor', path: currentPath, offset: view.state.selection.main.head });
        }, CURSOR_DEBOUNCE_MS);
      }
      if (!u.docChanged) return;
      if (pendingChange !== null) clearTimeout(pendingChange);
      pendingChange = setTimeout(flushChange, CHANGE_DEBOUNCE_MS);
    }),
  ];
}

// Reapplies what the app pushed for this file: diagnostics, breakpoints and the paused line.
function restoreFileState(path: string) {
  showDiagnostics(path);
  view.dispatch({
    effects: [setBreakpoints(breakpointsByPath.get(path) ?? []), execLineEffect(execLine?.path === path ? execLine.line : null)],
  });
}

// One state per file keeps undo history and cursor position across tab switches.
const states = new Map<string, EditorState>();

const view = new EditorView({
  parent: document.getElementById('editor')!,
  state: EditorState.create({ doc: '', extensions: baseExtensions('plain') }),
});

function open(path: string, content: string, lang: Language) {
  flushChange();
  // A suggestion belongs to the moment it was made, not to the cached state.
  dismissCompletion(view);
  if (currentPath !== null) states.set(currentPath, view.state);
  currentPath = path;
  currentLang = lang;
  const cached = states.get(path);
  if (cached && cached.doc.toString() === content) {
    view.setState(cached);
    // The theme and features may have changed while this file was in the background.
    view.dispatch({
      effects: [
        themeConf.reconfigure(themeExtension),
        featureConf.reconfigure(featureExtension()),
        optionsConf.reconfigure(optionExtension()),
        problemsConf.reconfigure(problemExtension()),
        closePeek,
      ],
    });
  } else {
    view.setState(EditorState.create({ doc: content, extensions: baseExtensions(lang) }));
    view.scrollDOM.scrollTop = 0;
  }
  restoreFileState(path);
}

function setContent(path: string, content: string, base: string | undefined) {
  if (path !== currentPath) {
    // open() compares the cached text with what it is given, so a stale state is dropped there.
    return;
  }
  const doc = view.state.doc.toString();
  // Typing that the app hasn't seen yet wins over a change computed from older text.
  if (base !== undefined && doc !== base) return;
  const change = minimalChange(doc, content);
  if (change) view.dispatch({ changes: change, userEvent: 'input.replace' });
}

function goto(path: string, line: number, column = 1) {
  if (path !== currentPath) return;
  const n = Math.min(Math.max(1, Math.floor(line)), view.state.doc.lines);
  const docLine = view.state.doc.line(n);
  const pos = Math.min(docLine.from + Math.max(0, Math.floor(column) - 1), docLine.to);
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
}

// Text typed from the accessory bar goes through the same input handlers as the
// keyboard, so auto-closing brackets and quotes behave the same.
function typeText(text: string) {
  const { from, to } = view.state.selection.main;
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((h) => h(view, from, to, text, () => view.state.update(view.state.replaceSelection(text))));
  if (!handled) {
    view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input.type' });
  }
}

function pressKey(key: EditorKey, select = false) {
  switch (key) {
    case 'left':
      return (select ? selectCharLeft : cursorCharLeft)(view);
    case 'right':
      return (select ? selectCharRight : cursorCharRight)(view);
    case 'up':
      return (select ? selectLineUp : cursorLineUp)(view);
    case 'down':
      return (select ? selectLineDown : cursorLineDown)(view);
    case 'home':
      return (select ? selectLineBoundaryBackward : cursorLineBoundaryBackward)(view);
    case 'end':
      return (select ? selectLineBoundaryForward : cursorLineBoundaryForward)(view);
    case 'tab':
      if (ghostOf(view.state)) return acceptGhost(view, 'all');
      if (completionStatus(view.state) === 'active') return acceptCompletion(view);
      if (!view.state.selection.main.empty) return indentMore(view);
      typeText(view.state.facet(indentUnit));
      return true;
  }
}

function selectUnit(unit: SelectUnit) {
  switch (unit) {
    case 'all':
      return selectAll(view);
    case 'line':
      return selectLine(view);
    case 'expand':
      // Grows to the enclosing syntax node: word, expression, block, function...
      return selectParentSyntax(view);
    case 'word': {
      const { state } = view;
      const word = state.wordAt(state.selection.main.head);
      if (word) view.dispatch({ selection: { anchor: word.from, head: word.to } });
      return true;
    }
  }
}

// With nothing selected, copy and cut take the whole line, like most editors.
function copy(cut: boolean) {
  const { state } = view;
  const ranges = state.selection.ranges;
  const empty = ranges.every((r) => r.empty);
  const parts = empty
    ? ranges.map((r) => {
        const line = state.doc.lineAt(r.head);
        return { from: line.from, to: Math.min(line.to + 1, state.doc.length), text: state.sliceDoc(line.from, line.to) + '\n' };
      })
    : ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to, text: state.sliceDoc(r.from, r.to) }));
  post({ type: 'clipboard', text: parts.map((p) => p.text).join(empty ? '' : '\n') });
  if (cut) view.dispatch({ changes: parts.map(({ from, to }) => ({ from, to })), userEvent: 'delete.cut' });
}

function setFont(font: CodeFont, ligatures: boolean) {
  const root = document.documentElement.style;
  root.setProperty('--tide-code-font', `'${CODE_FONTS[font].family}'`);
  root.setProperty('--tide-liga', ligatures ? 'normal' : 'none');
  root.setProperty('--tide-features', ligatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0');
  // Glyph widths change with the font; remeasure once it has loaded.
  document.fonts
    .load(`14px '${CODE_FONTS[font].family}'`)
    .catch(() => undefined)
    .then(() => view.requestMeasure());
}

function handle(msg: ToEditor) {
  switch (msg.type) {
    case 'open':
      return open(msg.path, msg.content, msg.language);
    case 'setTheme':
      theme = msg.theme;
      themeExtension = buildTheme(msg.theme, msg.dark);
      setGhostTheme(msg.theme);
      document.body.style.backgroundColor = msg.theme.background;
      view.dom.style.fontSize = `${msg.fontSize}px`;
      // Indent guides take their colors from the theme.
      view.dispatch({ effects: [themeConf.reconfigure(themeExtension), optionsConf.reconfigure(optionExtension())] });
      return view.requestMeasure();
    case 'setFont':
      return setFont(msg.font, msg.ligatures);
    case 'undo':
      return undo(view);
    case 'redo':
      return redo(view);
    case 'find':
      return openSearchPanel(view);
    case 'goto':
      return goto(msg.path, msg.line, msg.column);
    case 'insert':
      return typeText(msg.text);
    case 'key':
      return pressKey(msg.key, msg.select);
    case 'moveCursor':
      return view.dispatch(moveCursor(view.state, msg.by, msg.select));
    case 'insertLiteral':
      return view.dispatch(insertLiteral(view.state, msg.text, msg.cursor));
    case 'select':
      return selectUnit(msg.unit);
    case 'copy':
      return copy(msg.cut);
    case 'focus':
      return view.focus();
    case 'blur':
      return view.contentDOM.blur();
    case 'options':
      options = msg.options;
      view.dispatch({ effects: [optionsConf.reconfigure(optionExtension()), problemsConf.reconfigure(problemExtension())] });
      return view.requestMeasure();
    case 'features':
      features = msg.features;
      view.dispatch({ effects: featureConf.reconfigure(featureExtension()) });
      if (currentPath) restoreFileState(currentPath);
      return;
    case 'setContent':
      return setContent(msg.path, msg.content, msg.base);
    case 'diagnostics':
      diagnostics.set(msg.path, msg.items);
      return showDiagnostics(msg.path);
    case 'response':
      return requests.settle(msg.id, msg.result);
    case 'breakpoints':
      breakpointsByPath.set(msg.path, msg.lines);
      if (msg.path === currentPath && breakpointLines(view.state).join() !== [...msg.lines].sort((a, b) => a - b).join()) {
        view.dispatch({ effects: setBreakpoints(msg.lines) });
      }
      return;
    case 'execLine':
      execLine = msg.path ? { path: msg.path, line: msg.line } : null;
      if (currentPath) view.dispatch({ effects: execLineEffect(execLine?.path === currentPath ? execLine.line : null) });
      if (execLine && execLine.path === currentPath) goto(execLine.path, execLine.line);
      return;
    case 'complete':
      return startCompletion(view);
    case 'peek':
      return peekConfig.request(view.state.selection.main.head);
    case 'showPeek':
      if (msg.path !== currentPath) return;
      return view.dispatch({ effects: showPeek(peekAt(view.state, msg.offset, msg.target)) });
    case 'gotoProblem': {
      const text = gotoProblem(view, msg.direction);
      // Said by the app: VoiceOver focus is on the app's action, not the page.
      return post({ type: 'announce', text });
    }
    case 'setGestures':
      gestures = msg.gestures;
      return;
    case 'setAiFix':
      if (aiFix === msg.enabled) return;
      aiFix = msg.enabled;
      return view.dispatch({ effects: problemsConf.reconfigure(problemExtension()) });
    case 'setCompletions':
      return setCompletions(view, msg.enabled, msg.model);
    case 'completion':
      return showCompletion(view, msg.requestId, msg.text);
    case 'acceptCompletion':
      return acceptGhost(view, msg.part);
    case 'dismissCompletion':
      return dismissCompletion(view);
    case 'nextCompletion':
      return nextCompletion(view, ghostHost);
  }
}

window.tide = {
  receive(raw) {
    const msg = parseToEditor(raw);
    if (msg) handle(msg);
  },
};

// Touch gestures (gestures.ts). Off until the app says which are on.
let gestures: EditorGestures = NO_GESTURES;
// iOS has its own three-finger undo swipe, which arrives as a historyUndo /
// historyRedo beforeinput; when both fire for one swipe, only the first counts.
const HISTORY_DEDUPE_MS = 600;
let gestureHistoryAt = -Infinity;
let systemHistoryAt = -Infinity;
document.addEventListener(
  'beforeinput',
  (e) => {
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    if (performance.now() - gestureHistoryAt < HISTORY_DEDUPE_MS) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else systemHistoryAt = performance.now();
  },
  true,
);
const pullStyle = document.createElement('style');
pullStyle.textContent = PULL_PILL_CSS;
document.head.appendChild(pullStyle);
const pullPill = createPullPill(document.body);
attachGestures(view.dom, {
  flags: () => gestures,
  fontSize: () => parseFloat(view.dom.style.fontSize) || 14,
  scrollTop: () => view.scrollDOM.scrollTop,
  inContent: (target) => target instanceof Node && view.contentDOM.contains(target),
  onEvent(e) {
    switch (e.type) {
      case 'tab':
        return post({ type: 'shortcut', id: e.direction === 'next' ? 'next-tab' : 'prev-tab' });
      case 'zoom':
        view.dom.style.fontSize = `${e.fontSize}px`;
        view.requestMeasure();
        // The app saves it, which sends it back with the theme.
        if (e.done) post({ type: 'zoom', fontSize: e.fontSize });
        return;
      case 'history':
        if (performance.now() - systemHistoryAt < HISTORY_DEDUPE_MS) return;
        gestureHistoryAt = performance.now();
        (e.action === 'undo' ? undo : redo)(view);
        return;
      case 'pull':
        return pullPill.update(e.distance, e.armed);
      case 'pullEnd':
        pullPill.hide();
        if (e.open) post({ type: 'shortcut', id: 'palette' });
        return;
      case 'actions':
        return post({ type: 'actions' });
    }
  },
});

window.addEventListener('error', (e) => post({ type: 'error', message: String(e.message) }));
// Don't lose the last keystrokes if the app is backgrounded mid-debounce.
document.addEventListener('visibilitychange', flushChange);

post({ type: 'ready' });
