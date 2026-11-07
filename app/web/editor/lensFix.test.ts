// "✦ Fix" in the error lens: shown on error and warning lines only when the
// app turned it on, and a tap reports the line. Read from the decorations,
// with a minimal document for the widget's DOM (the RN test preset has none).
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { DecorationSet, EditorView, WidgetType } from '@codemirror/view';

import { FixHandler, fixable, problemExtensions } from './problems';

const doc = ['let a = b;', 'ok();', 'let c;', 'note'].join('\n');
// Line 1: error, line 3: warning, line 4: info.
const diags: Diagnostic[] = [
  { from: 8, to: 9, severity: 'error', message: 'b is not defined' },
  { from: 21, to: 22, severity: 'warning', message: 'c is unused' },
  { from: 24, to: 28, severity: 'info', message: 'a note' },
];

interface FakeEl {
  className: string;
  textContent: string;
  children: FakeEl[];
  append(...c: FakeEl[]): void;
  setAttribute(): void;
  onclick?: (e: { preventDefault(): void; stopPropagation(): void }) => void;
}
const fakeDocument = {
  createElement: (): FakeEl => {
    const el: FakeEl = { className: '', textContent: '', children: [], append: (...c) => el.children.push(...c), setAttribute: () => undefined };
    return el;
  },
};

function lenses(onFix: FixHandler | null): FakeEl[] {
  const base = EditorState.create({ doc, extensions: problemExtensions({ errorLens: true, onFix }) });
  const state = base.update(setDiagnostics(base, diags)).state;
  const out: FakeEl[] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue;
    (source as DecorationSet).between(0, state.doc.length, (_from, _to, deco) => {
      const widget = deco.spec.widget as WidgetType | undefined;
      if (widget) out.push(widget.toDOM({} as EditorView) as unknown as FakeEl);
    });
  }
  return out;
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = fakeDocument;
});
afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
});

const fixOf = (lens: FakeEl) => lens.children.find((c) => c.className === 'cm-error-lens-fix');

it('knows which severities get a Fix', () => {
  expect([fixable('error'), fixable('warning'), fixable('info')]).toEqual([true, true, false]);
});

it('hides Fix unless the app turned it on', () => {
  const list = lenses(null);
  expect(list).toHaveLength(3);
  expect(list.map(fixOf)).toEqual([undefined, undefined, undefined]);
});

it('shows Fix right after error and warning lens messages and reports the tapped line', () => {
  const onFix = jest.fn();
  const list = lenses(onFix);
  expect(list.map((l) => fixOf(l)?.textContent)).toEqual(['✦ Fix', '✦ Fix', undefined]);
  expect(list[0].children.map((c) => c.className)).toEqual(['cm-error-lens-shape', 'cm-error-lens-text', 'cm-error-lens-fix']);
  fixOf(list[1])!.onclick!({ preventDefault: () => undefined, stopPropagation: () => undefined });
  expect(onFix).toHaveBeenCalledWith(3);
});
