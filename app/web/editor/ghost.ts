// AI inline completions shown as ghost text at the cursor. The editor asks
// the app ('requestCompletion') once typing pauses; the app answers with a
// 'completion' that is shown only if nothing has changed since. Tab accepts,
// Alt/Option-Right takes a word, Escape or moving the cursor dismisses, and
// typing the suggestion's next characters consumes them.
import { Annotation, EditorSelection, EditorState, Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, keymap, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';

import type { FromEditor } from '../../src/features/editor/bridge';
import type { EditorTheme } from '../../src/theme/editor';
import { accept, canRequest, context, freshGhost, Ghost, GHOST_DEBOUNCE_MS, PendingRequest, shortModelName, typeThrough } from './ghostState';

export interface GhostHost {
  post(msg: FromEditor): void;
  path(): string | null;
}

const HINT_MS = 4000;

let enabled = false;
let model: string | undefined;
let pending: PendingRequest<EditorState['doc']> | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
// What the app was last told, so it hears only of changes.
let reportedVisible = false;
let hintShown = false;

const setGhost = StateEffect.define<Ghost | null>();
// Edits the ghost makes itself (accepting, typing through) don't ask again.
const ghostEdit = Annotation.define<boolean>();

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    return value && (tr.docChanged || tr.selection) ? null : value;
  },
});

class GhostWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly block: boolean,
  ) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text && other.block === this.block;
  }
  toDOM() {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = this.block ? 'cm-ghost cm-ghost-block' : 'cm-ghost';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

// The first line inline after the cursor; the rest as a block under the line.
function decorations(state: EditorState): DecorationSet {
  const ghost = state.field(ghostField, false);
  if (!ghost) return Decoration.none;
  const nl = ghost.text.indexOf('\n');
  const first = nl === -1 ? ghost.text : ghost.text.slice(0, nl);
  const ranges = [];
  if (first) ranges.push(Decoration.widget({ widget: new GhostWidget(first, false), side: 1 }).range(ghost.pos));
  if (nl !== -1) {
    const lineEnd = state.doc.lineAt(ghost.pos).to;
    ranges.push(Decoration.widget({ widget: new GhostWidget(ghost.text.slice(nl + 1), true), side: 1, block: true }).range(lineEnd));
  }
  return Decoration.set(ranges, true);
}

export const ghostOf = (state: EditorState) => state.field(ghostField, false) ?? null;

function cancelTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function request(view: EditorView, host: GhostHost, explicit: boolean) {
  const path = host.path();
  if (!enabled || path === null) return;
  const { state } = view;
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const ok = canRequest({
    docLength: state.doc.length,
    empty: main.empty,
    multi: state.selection.ranges.length > 1,
    head: main.head,
    lineEnd: explicit ? main.head : line.to,
    nextChar: state.sliceDoc(main.head, main.head + 1),
  });
  if (!ok) return;
  const requestId = nextId++;
  pending = { requestId, doc: state.doc, head: main.head };
  const { prefix, suffix } = context(state.doc.toString(), main.head);
  host.post({ type: 'requestCompletion', requestId, path, prefix, suffix });
}

// The app's answer to a 'requestCompletion'.
export function showCompletion(view: EditorView, requestId: number, text: string) {
  const { state } = view;
  const ghost = freshGhost(pending, { requestId, text }, { doc: state.doc, head: state.selection.main.head, empty: state.selection.main.empty });
  if (pending?.requestId === requestId) pending = null;
  if (ghost && enabled) view.dispatch({ effects: setGhost.of(ghost) });
}

export function acceptCompletion(view: EditorView, part: 'all' | 'word'): boolean {
  const ghost = ghostOf(view.state);
  if (!ghost) return false;
  const { insert, rest } = accept(ghost, part);
  const end = ghost.pos + insert.length;
  // Inserted as is: no auto-closed brackets or quotes.
  view.dispatch({
    changes: { from: ghost.pos, insert },
    selection: EditorSelection.cursor(end),
    effects: setGhost.of(rest),
    annotations: ghostEdit.of(true),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  return true;
}

export function dismissCompletion(view: EditorView): boolean {
  cancelTimer();
  pending = null;
  if (!ghostOf(view.state)) return false;
  view.dispatch({ effects: setGhost.of(null) });
  return true;
}

// "Next" in the key bar: drop this one and ask again now.
export function nextCompletion(view: EditorView, host: GhostHost) {
  dismissCompletion(view);
  request(view, host, true);
}

export function setCompletions(view: EditorView, on: boolean, modelName?: string) {
  enabled = on;
  model = modelName;
  if (!on) dismissCompletion(view);
}

// Faded comment color for the suggestion; the hint chip uses the tooltip colors.
export function setGhostTheme(theme: EditorTheme) {
  const root = document.documentElement.style;
  root.setProperty('--tide-ghost-color', theme.syntax.comment);
  root.setProperty('--tide-hint-bg', theme.activeLine);
  root.setProperty('--tide-hint-fg', theme.foreground);
  root.setProperty('--tide-hint-border', theme.gutterBorder);
}

// "✦ Haiku 5.5 · Tab Accept · ⌥→ Word · Esc", once per session, under the line.
let hint: HTMLElement | null = null;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

function hideHint() {
  if (hintTimer !== null) clearTimeout(hintTimer);
  hintTimer = null;
  hint?.remove();
  hint = null;
}

function showHint(view: EditorView, pos: number) {
  hintShown = true;
  view.requestMeasure({
    read: (v) => v.coordsAtPos(pos),
    write: (coords) => {
      if (!coords || !ghostOf(view.state)) return;
      hideHint();
      const el = document.createElement('div');
      el.className = 'tide-ghost-hint';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = `✦ ${shortModelName(model)} · Tab Accept · ⌥→ Word · Esc`;
      document.body.appendChild(el);
      const below = coords.bottom + 6 + el.offsetHeight < window.innerHeight;
      el.style.top = `${below ? coords.bottom + 6 : coords.top - 6 - el.offsetHeight}px`;
      el.style.left = `${Math.max(8, Math.min(coords.left, window.innerWidth - el.offsetWidth - 8))}px`;
      hint = el;
      hintTimer = setTimeout(hideHint, HINT_MS);
    },
  });
}

const HINT_CSS = `
  .tide-ghost-hint {
    position: fixed; z-index: 50; pointer-events: none; white-space: nowrap;
    font: 12px system-ui, sans-serif; padding: 3px 8px; border-radius: 6px;
    background: var(--tide-hint-bg, #222); color: var(--tide-hint-fg, #eee);
    border: 1px solid var(--tide-hint-border, #444); opacity: 0.95;
  }
`;
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = HINT_CSS;
  document.head.appendChild(style);
}

export function ghostExtension(host: GhostHost): Extension {
  const scheduler = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        this.report(view.state);
      }
      update(u: ViewUpdate) {
        this.report(u.state);
        const typed = u.transactions.some(
          (tr) => !tr.annotation(ghostEdit) && (tr.isUserEvent('input.type') || tr.isUserEvent('input.complete') || tr.isUserEvent('delete')),
        );
        if (u.docChanged && typed) {
          cancelTimer();
          pending = null;
          if (enabled && !ghostOf(u.state)) timer = setTimeout(() => ((timer = null), request(u.view, host, false)), GHOST_DEBOUNCE_MS);
        } else if (u.docChanged || u.selectionSet) {
          cancelTimer();
          pending = null;
        }
      }
      report(state: EditorState) {
        const ghost = ghostOf(state);
        if (!!ghost === reportedVisible) return;
        reportedVisible = !!ghost;
        host.post({ type: 'completionState', visible: reportedVisible });
        if (!ghost) hideHint();
        else if (!hintShown) showHint(this.view, ghost.pos);
      }
      destroy() {
        cancelTimer();
      }
    },
  );
  return [
    ghostField,
    scheduler,
    EditorView.decorations.compute([ghostField], decorations),
    Prec.highest([
      keymap.of([
        { key: 'Tab', run: (v) => acceptCompletion(v, 'all') },
        { key: 'Alt-ArrowRight', run: (v) => acceptCompletion(v, 'word') },
        { key: 'Escape', run: dismissCompletion },
      ]),
      // Before closeBrackets, so a typed ) that matches the suggestion isn't doubled.
      EditorView.inputHandler.of((v, from, to, text) => {
        const ghost = ghostOf(v.state);
        if (!ghost || from !== to || from !== ghost.pos || !ghost.text.startsWith(text)) return false;
        v.dispatch({
          changes: { from, insert: text },
          selection: EditorSelection.cursor(from + text.length),
          effects: setGhost.of(typeThrough(ghost, text, from)),
          annotations: ghostEdit.of(true),
          userEvent: 'input.type',
          scrollIntoView: true,
        });
        return true;
      }),
    ]),
    EditorView.baseTheme({
      '.cm-ghost': { color: 'var(--tide-ghost-color, #888)', opacity: '0.55', fontStyle: 'italic', pointerEvents: 'none' },
      '.cm-ghost-block': { padding: '0 2px 0 6px', whiteSpace: 'pre-wrap' },
    }),
  ];
}
