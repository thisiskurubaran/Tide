// Line commands: sort, reverse, join, duplicate, delete and case changes.
// Each is a CodeMirror command and makes one transaction, so one undo
// reverts it. With nothing selected, sort and reverse take the whole
// document, join takes the current line and the next, duplicate and delete
// take the current line, and case changes take the word at the cursor.
import { copyLineDown, deleteLine } from '@codemirror/commands';
import { EditorSelection, EditorState, SelectionRange, StateCommand } from '@codemirror/state';
import type { Command } from '@codemirror/view';

import type { LineCommand } from '../../src/features/editor/bridge';

type Block = { first: number; last: number };

// Line numbers a range covers. A selection that ends at the very start of a
// line (after selecting whole lines with Shift-Down) doesn't take that line.
function rangeLines(state: EditorState, r: SelectionRange): Block {
  const first = state.doc.lineAt(r.from).number;
  let last = state.doc.lineAt(r.to).number;
  if (last > first && state.doc.line(last).from === r.to) last--;
  return { first, last };
}

function mergeBlocks(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((x, y) => x.first - y.first);
  const out: Block[] = [];
  for (const b of sorted) {
    const prev = out[out.length - 1];
    if (prev && b.first <= prev.last) prev.last = Math.max(prev.last, b.last);
    else out.push({ ...b });
  }
  return out;
}

const blockText = (state: EditorState, b: Block) => {
  const lines: string[] = [];
  for (let n = b.first; n <= b.last; n++) lines.push(state.doc.line(n).text);
  return lines;
};

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true }) : null;
const compare = (x: string, y: string) => (collator ? collator.compare(x, y) : x < y ? -1 : x > y ? 1 : 0);

// Sort or reverse the selected lines, or every line when nothing is selected.
function reorder(transform: (lines: string[]) => string[]): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const selected = state.selection.ranges.filter((r) => !r.empty);
    const blocks = selected.length ? mergeBlocks(selected.map((r) => rangeLines(state, r))) : [{ first: 1, last: state.doc.lines }];
    const changes: { from: number; to: number; insert: string }[] = [];
    const ranges: SelectionRange[] = [];
    for (const b of blocks) {
      if (b.last <= b.first) continue;
      const from = state.doc.line(b.first).from;
      const to = state.doc.line(b.last).to;
      const lines = blockText(state, b);
      const next = transform(lines).join('\n');
      if (next !== lines.join('\n')) changes.push({ from, to, insert: next });
      // The lines stay the same length overall, so offsets don't shift.
      ranges.push(EditorSelection.range(from, to));
    }
    if (!changes.length) return false;
    // With nothing selected, the cursor stays at the same offset.
    const selection = selected.length ? EditorSelection.create(ranges) : state.selection;
    dispatch(state.update({ changes, selection, scrollIntoView: true, userEvent: 'input.lines' }));
    return true;
  };
}

export const sortAscending = reorder((lines) => [...lines].sort(compare));
export const sortDescending = reorder((lines) => [...lines].sort((x, y) => compare(y, x)));
export const reverseLines = reorder((lines) => [...lines].reverse());

// Joins each selection's lines into one, or the current line with the next.
// Leading whitespace of a joined line goes; one space goes between, unless
// either side is empty or already ends in whitespace.
export const joinLines: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const blocks = mergeBlocks(
    state.selection.ranges.map((r) => {
      const b = rangeLines(state, r);
      return b.last > b.first ? b : { first: b.first, last: Math.min(b.first + 1, state.doc.lines) };
    }),
  ).filter((b) => b.last > b.first);
  if (!blocks.length) return false;
  const changes: { from: number; to: number; insert: string }[] = [];
  const ranges: SelectionRange[] = [];
  let shift = 0;
  for (const b of blocks) {
    const from = state.doc.line(b.first).from;
    const to = state.doc.line(b.last).to;
    let joined = state.doc.line(b.first).text;
    let joinPoint = from + joined.length;
    for (let n = b.first + 1; n <= b.last; n++) {
      const next = state.doc.line(n).text.replace(/^\s+/, '');
      const sep = joined === '' || next === '' || /\s$/.test(joined) ? '' : ' ';
      if (n === b.first + 1) joinPoint = from + joined.length;
      joined += sep + next;
    }
    changes.push({ from, to, insert: joined });
    const single = b.last === b.first + 1 && state.selection.ranges.some((r) => r.empty && state.doc.lineAt(r.head).number === b.first);
    ranges.push(single ? EditorSelection.cursor(joinPoint + shift) : EditorSelection.range(from + shift, from + shift + joined.length));
    shift += joined.length - (to - from);
  }
  dispatch(state.update({ changes, selection: EditorSelection.create(ranges), scrollIntoView: true, userEvent: 'input.lines' }));
  return true;
};

// Copies each selection right after itself and selects the copy; with
// nothing selected, copies the line below (like Shift-Alt-Down).
export const duplicateSelection: StateCommand = (target) => {
  const { state, dispatch } = target;
  if (state.readOnly) return false;
  if (state.selection.ranges.every((r) => r.empty)) return copyLineDown(target);
  dispatch(
    state.update(
      state.changeByRange((r) => {
        if (r.empty) return { range: r };
        const text = state.sliceDoc(r.from, r.to);
        return { changes: { from: r.to, insert: text }, range: EditorSelection.range(r.to, r.to + text.length) };
      }),
      { scrollIntoView: true, userEvent: 'input.duplicate' },
    ),
  );
  return true;
};

export const titleCase = (text: string) => text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, before: string, c: string) => before + c.toUpperCase());

// Changes the case of each selection, or of the word at the cursor.
function changeCase(transform: (text: string) => string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    let changed = false;
    const spec = state.changeByRange((r) => {
      const target = r.empty ? state.wordAt(r.head) : r;
      if (!target) return { range: r };
      const text = state.sliceDoc(target.from, target.to);
      const next = transform(text);
      if (next === text) return { range: r };
      changed = true;
      const range = r.empty ? EditorSelection.cursor(Math.min(r.head, target.from + next.length)) : EditorSelection.range(r.anchor < r.head ? target.from : target.from + next.length, r.anchor < r.head ? target.from + next.length : target.from);
      return { changes: { from: target.from, to: target.to, insert: next }, range };
    });
    if (!changed) return false;
    dispatch(state.update(spec, { userEvent: 'input.case' }));
    return true;
  };
}

export const upperCase = changeCase((t) => t.toUpperCase());
export const lowerCase = changeCase((t) => t.toLowerCase());
export const toTitleCase = changeCase(titleCase);

// Delete line is CodeMirror's own (Shift-Mod-K), which needs the view.
export const LINE_COMMAND_RUN: Record<LineCommand, Command> = {
  sortAsc: sortAscending,
  sortDesc: sortDescending,
  reverse: reverseLines,
  join: joinLines,
  duplicate: duplicateSelection,
  deleteLine,
  upper: upperCase,
  lower: lowerCase,
  title: toTitleCase,
};
