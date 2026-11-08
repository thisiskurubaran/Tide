import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, StateCommand, Transaction } from '@codemirror/state';

import { lineChanges } from './lineDiff';
import { duplicateSelection, joinLines, lowerCase, reverseLines, sortAscending, sortDescending, titleCase, toTitleCase, upperCase } from './lines';

const make = (doc: string, ranges: [number, number?][] = [[0]]) =>
  EditorState.create({
    doc,
    extensions: [history(), EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h ?? a))),
  });

function run(cmd: StateCommand, state: EditorState): EditorState {
  let tr: Transaction | null = null;
  const ok = cmd({ state, dispatch: (t) => (tr = t) });
  if (!ok || !tr) return state;
  return (tr as Transaction).state;
}

const sel = (s: EditorState) => s.selection.ranges.map((r) => [r.anchor, r.head]);

describe('sort and reverse', () => {
  it('sorts the whole document when nothing is selected, keeping the cursor offset', () => {
    const s = run(sortAscending, make('pear\napple\nfile10\nfile2', [[3]]));
    expect(s.doc.toString()).toBe('apple\nfile2\nfile10\npear');
    expect(sel(s)).toEqual([[3, 3]]);
    expect(run(sortDescending, s).doc.toString()).toBe('pear\nfile10\nfile2\napple');
  });

  it('sorts only the selected lines and selects them', () => {
    // From inside "c" to the start of "z": the z line isn't included.
    const doc = 'top\nc\nb\na\nz';
    const s = run(sortAscending, make(doc, [[5, 10]]));
    expect(s.doc.toString()).toBe('top\na\nb\nc\nz');
    expect(sel(s)).toEqual([[4, 9]]);
  });

  it('reverses lines, and undo puts them back in one step', () => {
    const s = run(reverseLines, make('1\n2\n3'));
    expect(s.doc.toString()).toBe('3\n2\n1');
    let back = s;
    undo({ state: s, dispatch: (t) => (back = t.state) });
    expect(back.doc.toString()).toBe('1\n2\n3');
  });

  it('does nothing when already in order', () => {
    const s = make('a\nb');
    expect(run(sortAscending, s)).toBe(s);
  });
});

describe('join lines', () => {
  it('joins the current line with the next, dropping its indentation', () => {
    const s = run(joinLines, make('if (a) {\n    go();\n}', [[2]]));
    expect(s.doc.toString()).toBe('if (a) { go();\n}');
    expect(sel(s)).toEqual([[8, 8]]);
  });

  it('joins every selected line', () => {
    const s = run(joinLines, make('a\n  b\n\nc\nd', [[0, 8]]));
    expect(s.doc.toString()).toBe('a b c\nd');
  });

  it('does nothing on the last line', () => {
    const s = make('only', [[1]]);
    expect(run(joinLines, s)).toBe(s);
  });
});

describe('duplicate', () => {
  it('copies the line down with nothing selected', () => {
    const s = run(duplicateSelection, make('one\ntwo', [[1]]));
    expect(s.doc.toString()).toBe('one\none\ntwo');
    expect(sel(s)).toEqual([[5, 5]]);
  });

  it('copies a selection right after itself and selects the copy', () => {
    const s = run(duplicateSelection, make('ab cd', [[0, 2]]));
    expect(s.doc.toString()).toBe('abab cd');
    expect(sel(s)).toEqual([[2, 4]]);
  });
});

describe('case', () => {
  it('changes the selection, keeping it selected', () => {
    const s = run(upperCase, make('hello world', [[0, 5]]));
    expect(s.doc.toString()).toBe('HELLO world');
    expect(sel(s)).toEqual([[0, 5]]);
    expect(run(lowerCase, make('ABC', [[3, 0]])).doc.toString()).toBe('abc');
  });

  it('changes the word at the cursor when nothing is selected', () => {
    const s = run(toTitleCase, make('say HELLO there', [[6]]));
    expect(s.doc.toString()).toBe('say Hello there');
    expect(sel(s)).toEqual([[6, 6]]);
  });

  it('title-cases words, not letters after an apostrophe', () => {
    expect(titleCase("it's the END of élan-vital")).toBe("It's The End Of Élan-Vital");
  });
});

describe('lineChanges', () => {
  const apply = (s: string, cs: { from: number; to: number; insert: string }[]) => EditorState.create({ doc: s }).update({ changes: cs }).state.doc.toString();

  it('makes one small change per trimmed line, and adds the final newline', () => {
    const from = 'a  \nb\nc\t\nd';
    const to = 'a\nb\nc\nd\n';
    const cs = lineChanges(from, to);
    expect(cs).toEqual([
      { from: 1, to: 3, insert: '' },
      { from: 7, to: 8, insert: '' },
      { from: 10, to: 10, insert: '\n' },
    ]);
    expect(apply(from, cs)).toBe(to);
  });

  it('keeps a cursor on another line where it was', () => {
    const state = EditorState.create({ doc: 'x  \nhello', selection: { anchor: 7 } });
    const next = state.update({ changes: lineChanges('x  \nhello', 'x\nhello') }).state;
    expect(next.selection.main.head).toBe(5);
    expect(next.doc.lineAt(5).text).toBe('hello');
  });

  it('removes a final line, and falls back to one change for bigger moves', () => {
    expect(apply('a\nb\n', lineChanges('a\nb\n', 'a\nb'))).toBe('a\nb');
    const cs = lineChanges('a\nb\nc\nd', 'a\nd');
    expect(cs).toHaveLength(1);
    expect(apply('a\nb\nc\nd', cs)).toBe('a\nd');
    expect(lineChanges('same', 'same')).toEqual([]);
  });
});
