import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';

import { lineAnnouncement, problemAnnouncement } from './a11y';
import { closePeek, peekAt, peekField, showPeek } from './peek';
import { adjacentProblem, lineProblems, problems } from './problems';

const text = ['<p>', '  <b>hi</a>', '', 'end'].join('\n');
// Offsets: line 1 = 0..3, line 2 = 4..15, line 3 = 16, line 4 = 17..20.
const diags: Diagnostic[] = [
  { from: 11, to: 15, severity: 'error', message: 'Unexpected closing tag a' },
  { from: 6, to: 9, severity: 'warning', message: 'Unclosed b' },
  { from: 17, to: 20, severity: 'info', message: 'Trailing text\nmore detail' },
];

function withDiagnostics(doc = text, items = diags) {
  const state = EditorState.create({ doc, extensions: [peekField] });
  return state.update(setDiagnostics(state, items)).state;
}

describe('problems', () => {
  it('lists diagnostics in document order with their lines', () => {
    expect(problems(withDiagnostics()).map((p) => [p.line, p.severity])).toEqual([
      [2, 'warning'],
      [2, 'error'],
      [4, 'info'],
    ]);
  });

  it('keeps the worst severity per line, and its message for the lens', () => {
    const lines = lineProblems(problems(withDiagnostics()));
    expect(lines.get(2)?.severity).toBe('error');
    expect(lines.get(2)?.first.message).toBe('Unexpected closing tag a');
    expect(lines.get(2)?.all).toHaveLength(2);
    expect(lines.get(4)?.severity).toBe('info');
    expect(lines.has(1)).toBe(false);
  });

  it('follows edits', () => {
    const state = withDiagnostics();
    const edited = state.update({ changes: { from: 0, insert: 'top\n' } }).state;
    expect(problems(edited).map((p) => p.line)).toEqual([3, 3, 5]);
  });

  it('moves to the next and previous problem, wrapping around', () => {
    const list = problems(withDiagnostics());
    expect(adjacentProblem(list, 0, 1)?.from).toBe(6);
    expect(adjacentProblem(list, 6, 1)?.from).toBe(11);
    expect(adjacentProblem(list, 17, 1)?.from).toBe(6);
    expect(adjacentProblem(list, 11, -1)?.from).toBe(6);
    expect(adjacentProblem(list, 6, -1)?.from).toBe(17);
    expect(adjacentProblem([], 0, 1)).toBeNull();
  });
});

describe('announcements', () => {
  it('reads the line and its problems', () => {
    const state = withDiagnostics();
    expect(lineAnnouncement(state, 2)).toBe('Line 2. <b>hi</a>. Warning: Unclosed b. Error: Unexpected closing tag a');
    expect(lineAnnouncement(state, 3)).toBe('Line 3. blank');
    expect(lineAnnouncement(state, 4)).toBe('Line 4. end. Info: Trailing text');
  });

  it('says where a problem is among the others', () => {
    const list = problems(withDiagnostics());
    expect(problemAnnouncement(list, list[1])).toBe('Error 2 of 3, line 2: Unexpected closing tag a');
  });
});

describe('peek', () => {
  const target = { path: 'src/a.ts', line: 5, text: 'x\ny', startLine: 4 };

  it('sits under the line of the offset, clamped to the document', () => {
    const state = withDiagnostics();
    expect(peekAt(state, 12, target).under).toBe(2);
    expect(peekAt(state, 999, target).under).toBe(4);
  });

  it('closes on an edit or when asked', () => {
    const shown = withDiagnostics().update({ effects: showPeek(peekAt(withDiagnostics(), 12, target)) }).state;
    expect(shown.field(peekField)?.target).toEqual(target);
    expect(shown.update({ selection: { anchor: 0 } }).state.field(peekField)).not.toBeNull();
    expect(shown.update({ changes: { from: 0, insert: 'a' } }).state.field(peekField)).toBeNull();
    expect(shown.update({ effects: closePeek }).state.field(peekField)).toBeNull();
  });
});
