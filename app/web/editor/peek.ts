// Peek definition: the lines around a definition in a card under the cursor
// line, without leaving the file. The app finds and reads the definition; this
// only asks for it and draws it.
import { EditorState, Extension, Facet, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, keymap, lineNumbers, WidgetType } from '@codemirror/view';

import { languageFor, type PeekTarget } from '../../src/features/editor/bridge';
import { languageExtension } from './languages';

export interface PeekConfig {
  // Ask the app for the definition at `offset` in the open file.
  request(offset: number): void;
  // "Open": go to the definition.
  open(path: string, line: number): void;
  // The editor's theme, so the peeked code is colored like the file.
  theme(): Extension;
}

const peekConfig = Facet.define<PeekConfig, PeekConfig | null>({ combine: (v) => v[0] ?? null });

export interface Peek {
  // The line (1-based) the card sits under.
  under: number;
  target: PeekTarget | null;
}

const setPeek = StateEffect.define<Peek | null>();

// The card's position after `offset` is clamped to the document.
export function peekAt(state: EditorState, offset: number, target: PeekTarget | null): Peek {
  return { under: state.doc.lineAt(Math.min(Math.max(0, offset), state.doc.length)).number, target };
}

export const showPeek = (peek: Peek) => setPeek.of(peek);
export const closePeek = setPeek.of(null);

export const peekField = StateField.define<Peek | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPeek)) return e.value;
    // Editing anywhere closes it: the lines it sits under may be gone.
    return tr.docChanged ? null : value;
  },
});

// Block widgets have to come from a state field, so this one maps the peek to its card.
const peekDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    const peek = tr.state.field(peekField);
    if (peek === tr.startState.field(peekField, false)) return deco;
    if (!peek || peek.under > tr.state.doc.lines) return Decoration.none;
    return Decoration.set([
      Decoration.widget({ widget: new PeekWidget(peek), block: true, side: 1 }).range(tr.state.doc.line(peek.under).to),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const FILE_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';

const targetLine = Decoration.line({ class: 'cm-peek-target' });

// The card's own read-only editor, kept on its DOM node so destroy() finds it
// even after CodeMirror swapped in an equal widget.
const inners = new WeakMap<HTMLElement, EditorView>();

class PeekWidget extends WidgetType {
  constructor(readonly peek: Peek) {
    super();
  }
  eq(other: PeekWidget) {
    const a = this.peek.target;
    const b = other.peek.target;
    return other.peek.under === this.peek.under && (a === b || (!!a && !!b && a.path === b.path && a.line === b.line && a.text === b.text));
  }
  toDOM(view: EditorView) {
    const config = view.state.facet(peekConfig);
    const { target } = this.peek;
    const card = document.createElement('div');
    card.className = 'cm-peek';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', target ? `Peek definition, ${target.path} line ${target.line}` : 'Peek definition');

    const header = document.createElement('div');
    header.className = 'cm-peek-header';
    const icon = document.createElement('span');
    icon.className = 'cm-peek-icon';
    icon.innerHTML = FILE_ICON;
    const title = document.createElement('span');
    title.className = 'cm-peek-title';
    title.textContent = target ? `${target.path}:${target.line}` : 'No definition found';
    header.append(icon, title);
    const button = (label: string, cls: string, aria: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = (e) => {
        e.preventDefault();
        run();
      };
      header.appendChild(b);
    };
    if (target) button('Open', 'cm-peek-open', `Open ${target.path} at line ${target.line}`, () => {
      view.dispatch({ effects: closePeek });
      config?.open(target.path, target.line);
    });
    button('×', 'cm-peek-close', 'Close peek', () => {
      view.dispatch({ effects: closePeek });
      view.focus();
    });
    card.appendChild(header);

    if (target) {
      const body = document.createElement('div');
      body.className = 'cm-peek-body';
      card.appendChild(body);
      const offset = target.startLine - 1;
      const doc = EditorState.create({ doc: target.text }).doc;
      const mark = target.line - offset;
      const inner = new EditorView({
        parent: body,
        state: EditorState.create({
          doc: target.text,
          extensions: [
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            lineNumbers({ formatNumber: (n) => String(n + offset) }),
            languageExtension(languageFor(target.path)),
            config?.theme() ?? [],
            mark >= 1 && mark <= doc.lines ? EditorView.decorations.of(Decoration.set([targetLine.range(doc.line(mark).from)])) : [],
          ],
        }),
      });
      inners.set(card, inner);
      // Show the definition line, not the context above it.
      if (mark >= 1 && mark <= doc.lines) {
        requestAnimationFrame(() =>
          inner.dispatch({ effects: EditorView.scrollIntoView(inner.state.doc.line(mark).from, { y: 'start', yMargin: 20 }) }),
        );
      }
    }
    return card;
  }
  destroy(dom: HTMLElement) {
    inners.get(dom)?.destroy();
    inners.delete(dom);
  }
  // Taps, scrolls and selection inside the card stay in the card.
  ignoreEvent() {
    return true;
  }
}

export function peekExtension(config: PeekConfig): Extension[] {
  return [
    peekConfig.of(config),
    peekField,
    peekDecorations,
    Prec.highest(
      keymap.of([
        { key: 'Alt-F12', preventDefault: true, run: (view) => (config.request(view.state.selection.main.head), true) },
        {
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(peekField, false)) return false;
            view.dispatch({ effects: closePeek });
            return true;
          },
        },
      ]),
    ),
  ];
}
