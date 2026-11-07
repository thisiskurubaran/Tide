// With word wrap on, a wrapped line's continuation starts under its own
// indentation (plus two columns) instead of at the left edge, so markup and
// long calls stay readable on a phone. Done with padding plus a negative
// text-indent per line, which leaves the first row where it was.
import { Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

const HANG = 2;
// CodeMirror's own .cm-line left padding, kept.
const BASE_PADDING = '6px';
// Past this the hanging indent would leave too little room on a phone.
const MAX_INDENT = 24;

export function leadingColumns(text: string, tabSize: number): number {
  let cols = 0;
  for (const c of text) {
    if (c === ' ') cols++;
    else if (c === '\t') cols += tabSize - (cols % tabSize);
    else break;
  }
  return cols;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const cols = Math.min(leadingColumns(line.text, tabSize), MAX_INDENT) + HANG;
      builder.add(line.from, line.from, Decoration.line({ attributes: { style: `padding-left:calc(${cols}ch + ${BASE_PADDING});text-indent:-${cols}ch` } }));
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const wrapIndent: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
