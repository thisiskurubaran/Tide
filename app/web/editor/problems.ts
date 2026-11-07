// How problems look in the editor: a gutter shape per line by its worst
// severity (✕ error, ▲ warning, ● info), so they read without color, and the
// error lens, the line's first problem shown at its end. Both are drawn from
// the diagnostics CodeMirror lint holds, so they follow its edits.
import { forEachDiagnostic, setDiagnosticsEffect } from '@codemirror/lint';
import { EditorState, Extension, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, gutter, GutterMarker, showTooltip, Tooltip, WidgetType } from '@codemirror/view';

export type Severity = 'error' | 'warning' | 'info';

export const SHAPES: Record<Severity, string> = { error: '✕', warning: '▲', info: '●' };
export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };
const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

export interface Problem {
  from: number;
  to: number;
  severity: Severity;
  message: string;
  // 1-based, where `from` is now.
  line: number;
}

const severityOf = (s: string): Severity => (s === 'error' || s === 'warning' ? s : 'info');

// Every diagnostic at its current position, in document order.
export function problems(state: EditorState): Problem[] {
  const out: Problem[] = [];
  forEachDiagnostic(state, (d, from, to) => {
    out.push({ from, to, severity: severityOf(d.severity), message: d.message, line: state.doc.lineAt(from).number });
  });
  return out.sort((a, b) => a.from - b.from || RANK[b.severity] - RANK[a.severity]);
}

// Per line: the worst severity, and the problem the lens shows (the first of that severity).
export function lineProblems(list: Problem[]): Map<number, { severity: Severity; first: Problem; all: Problem[] }> {
  const out = new Map<number, { severity: Severity; first: Problem; all: Problem[] }>();
  for (const p of list) {
    const cur = out.get(p.line);
    if (!cur) out.set(p.line, { severity: p.severity, first: p, all: [p] });
    else {
      cur.all.push(p);
      if (RANK[p.severity] > RANK[cur.severity]) {
        cur.severity = p.severity;
        cur.first = p;
      }
    }
  }
  return out;
}

// The problem Next / Previous problem moves to from `pos`, wrapping around.
export function adjacentProblem(list: Problem[], pos: number, direction: 1 | -1): Problem | null {
  if (!list.length) return null;
  if (direction === 1) return list.find((p) => p.from > pos) ?? list[0];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].from < pos) return list[i];
  return list[list.length - 1];
}

// ---- Gutter shapes ----

class ShapeMarker extends GutterMarker {
  constructor(readonly severity: Severity) {
    super();
  }
  eq(other: ShapeMarker) {
    return other.severity === this.severity;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-problem-marker cm-problem-${this.severity}`;
    el.textContent = SHAPES[this.severity];
    return el;
  }
}
const MARKERS: Record<Severity, ShapeMarker> = { error: new ShapeMarker('error'), warning: new ShapeMarker('warning'), info: new ShapeMarker('info') };

// ---- Error lens ----

// "✦ Fix" after the lens message on error and warning lines, when the app says AI is set up.
export type FixHandler = (line: number) => void;
export const fixable = (severity: Severity) => severity === 'error' || severity === 'warning';

class LensWidget extends WidgetType {
  constructor(
    readonly severity: Severity,
    readonly message: string,
    readonly line: number,
    readonly onFix: FixHandler | null = null,
  ) {
    super();
  }
  eq(other: LensWidget) {
    return other.severity === this.severity && other.message === this.message && other.line === this.line && !other.onFix === !this.onFix;
  }
  toDOM(view: EditorView) {
    const pill = document.createElement('span');
    pill.className = `cm-error-lens cm-error-lens-${this.severity}`;
    // Screen readers hear the line's problems from the live announcement instead.
    pill.setAttribute('aria-hidden', 'true');
    const shape = document.createElement('span');
    shape.className = 'cm-error-lens-shape';
    shape.textContent = SHAPES[this.severity];
    const text = document.createElement('span');
    text.className = 'cm-error-lens-text';
    // One line only; long messages end in an ellipsis, the tap shows all of it.
    text.textContent = this.message.split('\n')[0];
    pill.append(shape, text);
    if (this.onFix && fixable(this.severity)) {
      const onFix = this.onFix;
      const fix = document.createElement('span');
      fix.className = 'cm-error-lens-fix';
      fix.textContent = '✦ Fix';
      fix.onmousedown = (e) => e.preventDefault();
      fix.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onFix(this.line);
      };
      pill.append(fix);
    }
    pill.onmousedown = (e) => e.preventDefault();
    pill.onclick = (e) => {
      e.preventDefault();
      revealLine(view, this.line);
    };
    return pill;
  }
  ignoreEvent() {
    return true;
  }
}

// ---- Tapping a lens or a marker: select the problem and show the line's messages ----

const showLine = StateEffect.define<number | null>();

const lineTip = StateField.define<Tooltip | null>({
  create: () => null,
  update(tip, tr) {
    for (const e of tr.effects) if (e.is(showLine)) return e.value === null ? null : tooltipFor(tr.state, e.value);
    return tr.docChanged || tr.selection ? null : tip;
  },
  provide: (f) => showTooltip.from(f),
});

function tooltipFor(state: EditorState, line: number): Tooltip | null {
  const entry = lineProblems(problems(state)).get(line);
  if (!entry) return null;
  return {
    pos: entry.first.from,
    above: true,
    create() {
      const ul = document.createElement('ul');
      ul.className = 'cm-tooltip-lint';
      for (const p of entry.all) {
        const li = document.createElement('li');
        li.className = `cm-diagnostic cm-diagnostic-${p.severity}`;
        const span = document.createElement('span');
        span.className = 'cm-diagnosticText';
        span.textContent = p.message;
        li.appendChild(span);
        ul.appendChild(li);
      }
      return { dom: ul };
    },
  };
}

export function revealLine(view: EditorView, line: number) {
  const entry = lineProblems(problems(view.state)).get(line);
  if (!entry) return;
  view.dispatch({ selection: { anchor: entry.first.from, head: entry.first.to }, scrollIntoView: true });
  // After the selection, which would otherwise close it.
  view.dispatch({ effects: showLine.of(line) });
}

// ---- Putting it together ----

interface Marks {
  gutter: RangeSet<GutterMarker>;
  lens: DecorationSet;
}

function buildMarks(state: EditorState, lens: boolean, onFix: FixHandler | null = null): Marks {
  const lines = lineProblems(problems(state));
  const nums = [...lines.keys()].sort((a, b) => a - b);
  const gutterRanges = nums.map((n) => MARKERS[lines.get(n)!.severity].range(state.doc.line(n).from));
  const lensRanges = lens
    ? nums.map((n) => {
        const { first } = lines.get(n)!;
        return Decoration.widget({ widget: new LensWidget(first.severity, first.message, n, onFix), side: 1 }).range(state.doc.line(n).to);
      })
    : [];
  return { gutter: RangeSet.of(gutterRanges), lens: Decoration.set(lensRanges) };
}

// `onFix`: shows "✦ Fix" in the lens of error and warning lines; null hides it.
export function problemExtensions(options: { errorLens: boolean; onFix?: FixHandler | null }): Extension[] {
  const onFix = options.onFix ?? null;
  const marks = StateField.define<Marks>({
    create: (state) => buildMarks(state, options.errorLens, onFix),
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((e) => e.is(setDiagnosticsEffect)) || tr.reconfigured) return buildMarks(tr.state, options.errorLens, onFix);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (m) => m.lens),
  });
  return [
    marks,
    lineTip,
    gutter({
      class: 'cm-problem-gutter',
      markers: (view) => view.state.field(marks).gutter,
      initialSpacer: () => MARKERS.error,
      domEventHandlers: {
        mousedown(view, line) {
          const n = view.state.doc.lineAt(line.from).number;
          if (!lineProblems(problems(view.state)).has(n)) return false;
          revealLine(view, n);
          return true;
        },
      },
    }),
  ];
}
