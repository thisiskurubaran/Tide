// The compare and merge view: CodeMirror's merge extension, shown either
// inline (unified, the phone default) or as two editors side by side.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';

import fontRegular from '../../assets/fonts/JetBrainsMono-Regular.ttf';
import { FromDiff, ToDiff } from '../../src/features/diff/bridge';
import type { EditorTheme } from '../../src/theme/editor';
import { languageExtension } from '../editor/languages';
import { buildTheme, FONT_FAMILY } from '../editor/theme';

const CHANGE_DEBOUNCE_MS = 150;

const style = document.createElement('style');
style.textContent = `
  @font-face { font-family: '${FONT_FAMILY}'; src: url(${fontRegular}) format('truetype'); }
  html, body { margin: 0; height: 100%; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
  #diff { height: 100%; }
  .cm-editor { height: 100%; }
  .cm-editor.cm-focused { outline: none; }
  .cm-scroller { font-family: '${FONT_FAMILY}', monospace; line-height: 1.5; font-variant-ligatures: none; }
  .cm-mergeView { height: 100%; overflow: auto; }
  .cm-mergeViewEditors { min-height: 100%; }
  .cm-mergeView .cm-editor { height: auto; }
  .cm-changedLine, .cm-insertedLine { background: rgba(46, 160, 67, 0.16) !important; }
  .cm-deletedChunk, .cm-deletedLine { background: rgba(248, 81, 73, 0.16) !important; }
  .cm-changedText { background: rgba(46, 160, 67, 0.35) !important; }
  .cm-deletedChunk .cm-deletedText, del.cm-deletedText { background: rgba(248, 81, 73, 0.35) !important; text-decoration: none; }
  .cm-merge-a .cm-changedLine { background: rgba(248, 81, 73, 0.16) !important; }
  .cm-merge-a .cm-changedText { background: rgba(248, 81, 73, 0.35) !important; }
  .cm-deletedChunk button { font: 13px -apple-system, system-ui, sans-serif; padding: 4px 10px; margin: 2px 4px 2px 0; border-radius: 6px; border: 0; }
  .cm-collapsedLines { font: 12px -apple-system, system-ui, sans-serif; opacity: 0.8; }
`;
document.head.appendChild(style);

const post = (msg: FromDiff) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

const root = document.getElementById('diff')!;
let theme: EditorTheme | null = null;
let dark = true;
let fontSize = 14;
let last: Extract<ToDiff, { type: 'show' }> | null = null;
let editable: EditorView | null = null;
let destroy: () => void = () => undefined;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let lastCount = -1;

function reportChunks(view: EditorView) {
  const count = getChunks(view.state)?.chunks.length ?? 0;
  if (count !== lastCount) post({ type: 'chunks', count });
  lastCount = count;
}

function common(lang: Extract<ToDiff, { type: 'show' }>['language']): Extension {
  return [
    lineNumbers(),
    drawSelection(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    languageExtension(lang),
    theme ? buildTheme(theme, dark) : [],
    EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
  ];
}

function controlButtons(labels: { accept: string; reject: string } | null) {
  if (!labels) return false;
  return (type: 'accept' | 'reject', action: (e: MouseEvent) => void) => {
    const button = document.createElement('button');
    button.name = type;
    button.textContent = labels[type];
    button.onmousedown = action;
    return button;
  };
}

const listener = EditorView.updateListener.of((u) => {
  if (u.docChanged) {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => post({ type: 'change', content: u.state.doc.toString() }), CHANGE_DEBOUNCE_MS);
  }
  reportChunks(u.view);
});

function show(msg: Extract<ToDiff, { type: 'show' }>) {
  destroy();
  last = msg;
  lastCount = -1;
  const canEdit = [EditorState.readOnly.of(!msg.editable), EditorView.editable.of(msg.editable)];
  const collapse = { margin: 3, minSize: 8 };
  if (msg.layout === 'split') {
    const view = new MergeView({
      a: { doc: msg.original, extensions: [common(msg.language), EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      b: { doc: msg.modified, extensions: [common(msg.language), ...canEdit, listener] },
      parent: root,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: collapse,
    });
    editable = view.b;
    destroy = () => view.destroy();
  } else {
    const view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: msg.modified,
        extensions: [
          common(msg.language),
          ...canEdit,
          unifiedMergeView({
            original: msg.original,
            mergeControls: controlButtons(msg.controls),
            gutter: true,
            highlightChanges: true,
            collapseUnchanged: collapse,
          }),
          listener,
        ],
      }),
    });
    editable = view;
    destroy = () => view.destroy();
  }
  reportChunks(editable);
}

function receive(raw: string) {
  let msg: ToDiff;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    switch (msg.type) {
      case 'show':
        return show(msg);
      case 'setTheme':
        theme = msg.theme;
        dark = msg.dark;
        fontSize = msg.fontSize;
        document.body.style.backgroundColor = msg.theme.background;
        // Rebuilt with the new theme, keeping any edits made so far.
        if (last && editable) show({ ...last, modified: editable.state.doc.toString(), original: getOriginal() ?? last.original });
        return;
      case 'next':
        if (editable) goToNextChunk(editable);
        return;
      case 'prev':
        if (editable) goToPreviousChunk(editable);
        return;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

// In the unified view, accepting a change moves it into the original.
function getOriginal(): string | null {
  if (!editable || last?.layout === 'split') return null;
  return getOriginalDoc(editable.state).toString();
}

window.tide = { receive };
post({ type: 'ready' });
