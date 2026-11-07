import { EditorSelection, EditorState } from '@codemirror/state';

import { insertLiteral, moveCursor } from './cursor';

const at = (doc: string, anchor: number, head = anchor) => EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
const main = (s: EditorState) => s.selection.main;

describe('moveCursor', () => {
  it('moves by characters across lines and stops at the ends', () => {
    const s = at('ab\ncd', 1);
    expect(main(s.update(moveCursor(s, 3)).state).head).toBe(4);
    expect(main(s.update(moveCursor(s, -5)).state).head).toBe(0);
    expect(main(s.update(moveCursor(s, 99)).state).head).toBe(5);
  });

  it('steps over a whole emoji', () => {
    const s = at('a👍b', 1);
    expect(main(s.update(moveCursor(s, 1)).state).head).toBe(3);
  });

  it('extends the selection in select mode and collapses it otherwise', () => {
    const s = at('hello', 1, 2);
    expect(main(s.update(moveCursor(s, 2, true)).state)).toMatchObject({
      anchor: 1,
      head: 4,
    });
    expect(main(s.update(moveCursor(s, 1)).state)).toMatchObject({
      anchor: 3,
      head: 3,
    });
  });
});

describe('insertLiteral', () => {
  it('puts the caret inside a pair', () => {
    const s = at('x', 1);
    const next = s.update(insertLiteral(s, '/*  */', 3)).state;
    expect(next.doc.toString()).toBe('x/*  */');
    expect(main(next).head).toBe(4);
  });

  it('wraps the selection with a pair and replaces it otherwise', () => {
    const s = at('a b', 2, 3);
    const wrapped = s.update(insertLiteral(s, '()', 1)).state;
    expect(wrapped.doc.toString()).toBe('a (b)');
    expect(main(wrapped)).toMatchObject({ anchor: 3, head: 4 });
    expect(s.update(insertLiteral(s, '=>')).state.doc.toString()).toBe('a =>');
  });
});
