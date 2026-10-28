import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completeAnyWord, completionKeymap, completionStatus } from '@codemirror/autocomplete';
import { cursorCharLeft, cursorCharRight, cursorLineDown, cursorLineUp, defaultKeymap, history, historyKeymap, indentMore, redo, undo } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

import fontRegular from '../../assets/fonts/JetBrainsMono-Regular.ttf';
import { EditorKey, FromEditor, Language, parseToEditor, ToEditor } from '../../src/features/editor/bridge';
import { buildTheme, FONT_FAMILY } from './theme';

const CHANGE_DEBOUNCE_MS = 150;

const style = document.createElement('style');
style.textContent = `
  @font-face { font-family: '${FONT_FAMILY}'; src: url(${fontRegular}) format('truetype'); }
  html, body { margin: 0; height: 100%; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
  #editor { height: 100%; }
  .cm-editor { height: 100%; font-size: 14px; }
  .cm-editor.cm-focused { outline: none; }
  .cm-scroller { font-family: '${FONT_FAMILY}', monospace; line-height: 1.5; font-variant-ligatures: none; }
`;
document.head.appendChild(style);

function post(msg: FromEditor) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

function languageExtension(lang: Language): Extension {
  switch (lang) {
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'python':
      return python();
    case 'json':
      return json();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'markdown':
      return markdown();
    default:
      return [];
  }
}

const languageConf = new Compartment();
const themeConf = new Compartment();
let themeExtension: Extension = [];

let currentPath: string | null = null;
let pendingChange: ReturnType<typeof setTimeout> | null = null;

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

function baseExtensions(lang: Language): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
    saveKeymap,
    languageConf.of(languageExtension(lang)),
    themeConf.of(themeExtension),
    EditorView.focusChangeEffect.of((_state, focusing) => {
      post({ type: 'focus', focused: focusing });
      return null;
    }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged || currentPath === null) return;
      if (pendingChange !== null) clearTimeout(pendingChange);
      pendingChange = setTimeout(flushChange, CHANGE_DEBOUNCE_MS);
    }),
  ];
}

// One state per file keeps undo history and cursor position across tab switches.
const states = new Map<string, EditorState>();

const view = new EditorView({
  parent: document.getElementById('editor')!,
  state: EditorState.create({ doc: '', extensions: baseExtensions('plain') }),
});

function open(path: string, content: string, lang: Language) {
  flushChange();
  if (currentPath !== null) states.set(currentPath, view.state);
  currentPath = path;
  const cached = states.get(path);
  if (cached && cached.doc.toString() === content) {
    view.setState(cached);
    // The theme may have changed while this file was in the background.
    view.dispatch({ effects: themeConf.reconfigure(themeExtension) });
    return;
  }
  view.setState(EditorState.create({ doc: content, extensions: baseExtensions(lang) }));
  view.scrollDOM.scrollTop = 0;
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

function pressKey(key: EditorKey) {
  switch (key) {
    case 'left':
      return cursorCharLeft(view);
    case 'right':
      return cursorCharRight(view);
    case 'up':
      return cursorLineUp(view);
    case 'down':
      return cursorLineDown(view);
    case 'tab':
      if (completionStatus(view.state) === 'active') return acceptCompletion(view);
      if (!view.state.selection.main.empty) return indentMore(view);
      typeText(view.state.facet(indentUnit));
      return true;
  }
}

function handle(msg: ToEditor) {
  switch (msg.type) {
    case 'open':
      return open(msg.path, msg.content, msg.language);
    case 'setTheme':
      themeExtension = buildTheme(msg.theme, msg.dark);
      document.body.style.backgroundColor = msg.theme.background;
      view.dom.style.fontSize = `${msg.fontSize}px`;
      view.dispatch({ effects: themeConf.reconfigure(themeExtension) });
      return view.requestMeasure();
    case 'undo':
      return undo(view);
    case 'redo':
      return redo(view);
    case 'find':
      return openSearchPanel(view);
    case 'insert':
      return typeText(msg.text);
    case 'key':
      return pressKey(msg.key);
    case 'focus':
      return view.focus();
    case 'blur':
      return view.contentDOM.blur();
  }
}

window.tide = {
  receive(raw) {
    const msg = parseToEditor(raw);
    if (msg) handle(msg);
  },
};

window.addEventListener('error', (e) => post({ type: 'error', message: String(e.message) }));
// Don't lose the last keystrokes if the app is backgrounded mid-debounce.
document.addEventListener('visibilitychange', flushChange);

post({ type: 'ready' });
