// Edits driven by the app's key bar that work on the state alone, so they can
// be tested without a DOM.
import { EditorSelection, EditorState, findClusterBreak, TransactionSpec } from '@codemirror/state';

// One character (grapheme) from `pos`; a line break counts as one.
function step(state: EditorState, pos: number, forward: boolean): number {
  const line = state.doc.lineAt(pos);
  if (forward ? pos === line.to : pos === line.from) {
    return forward ? Math.min(pos + 1, state.doc.length) : Math.max(pos - 1, 0);
  }
  return line.from + findClusterBreak(line.text, pos - line.from, forward);
}

// A whole swipe step arrives as one message, so fast drags don't flood the bridge.
export function moveCursor(state: EditorState, by: number, select = false): TransactionSpec {
  const forward = by > 0;
  const selection = EditorSelection.create(
    state.selection.ranges.map((r) => {
      let head = r.head;
      for (let i = 0; i < Math.abs(by); i++) head = step(state, head, forward);
      return select ? EditorSelection.range(r.anchor, head) : EditorSelection.cursor(head);
    }),
    state.selection.mainIndex,
  );
  return { selection, scrollIntoView: true, userEvent: 'select' };
}

// Typed as is, skipping auto-close, with the caret `cursor` characters in.
// A pair with the caret inside wraps the selection, like typing a bracket over it.
export function insertLiteral(state: EditorState, text: string, cursor = text.length): TransactionSpec {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  return {
    ...state.changeByRange((r) => {
      const inner = after ? state.sliceDoc(r.from, r.to) : '';
      const start = r.from + before.length;
      return {
        changes: { from: r.from, to: r.to, insert: before + inner + after },
        range: inner ? EditorSelection.range(start, start + inner.length) : EditorSelection.cursor(start),
      };
    }),
    scrollIntoView: true,
    userEvent: 'input.type',
  };
}
