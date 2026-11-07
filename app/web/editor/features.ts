// Editor behavior that paid extensions switch on: answers from the app for
// completions, hover and go to definition (IntelliSense), gutter
// breakpoints and the paused line (Debugger), and merge conflict actions
// (Git Tools). Everything is driven by messages; the logic lives in the app.
import { Completion, CompletionContext, CompletionResult, completeAnyWord } from '@codemirror/autocomplete';
import { Diagnostic, setDiagnostics } from '@codemirror/lint';
import { EditorState, Extension, RangeSet, StateEffect, StateField, Text } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  hoverTooltip,
  keymap,
  WidgetType,
} from '@codemirror/view';

import type {
  CompletionResult as AppCompletion,
  EditorDiagnostic,
  EditorFeatures,
  EditorRequest,
  FromEditor,
  HoverResult,
} from '../../src/features/editor/bridge';

type Post = (msg: FromEditor) => void;
type Ask = <T>(req: DistributiveOmit<EditorRequest, 'id'>) => Promise<T | null>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

const REQUEST_TIMEOUT_MS = 4000;

export function createRequests(post: Post) {
  let next = 0;
  const pending = new Map<number, (result: unknown) => void>();
  const ask: Ask = (req) =>
    new Promise((resolve) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result as never);
      });
      post({ type: 'request', id, ...req } as FromEditor);
    });
  const settle = (id: number, result: unknown) => {
    pending.get(id)?.(result);
    pending.delete(id);
  };
  return { ask, settle };
}

// ---- Completions and hover ----

// One source for every file: the app answers when IntelliSense is on and knows
// the language; otherwise words from the document, as before.
export function completionSource(enabled: () => boolean, path: () => string | null, ask: Ask) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const file = path();
    const word = context.matchBefore(/[\w$]+$/);
    const afterDot = context.matchBefore(/\.$/) !== null;
    if (!enabled() || !file) return completeAnyWord(context);
    if (!word && !afterDot && !context.explicit) return null;
    const result = await ask<AppCompletion>({ method: 'completion', path: file, offset: context.pos, explicit: context.explicit });
    if (context.aborted) return null;
    if (!result) return completeAnyWord(context);
    return {
      from: result.from,
      options: result.items.map((i): Completion => ({ label: i.label, type: i.type, detail: i.detail })),
      validFor: /^[\w$]*$/,
    };
  };
}

function hover(path: () => string | null, ask: Ask) {
  return hoverTooltip(async (_view, pos) => {
    const file = path();
    if (!file) return null;
    const result = await ask<HoverResult>({ method: 'hover', path: file, offset: pos });
    if (!result || !result.text) return null;
    return {
      pos: result.from,
      end: result.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-tide-hover';
        // The first paragraph is the signature, the rest documentation.
        const [signature, ...docs] = result.text.split('\n\n');
        const code = document.createElement('pre');
        code.textContent = signature;
        dom.appendChild(code);
        if (docs.length) {
          const p = document.createElement('div');
          p.className = 'cm-tide-hover-doc';
          p.textContent = docs.join('\n\n');
          dom.appendChild(p);
        }
        return { dom };
      },
    };
  });
}

function definition(path: () => string | null, post: Post): Extension {
  const go = (offset: number) => {
    const file = path();
    if (file) post({ type: 'definition', path: file, offset });
  };
  return [
    keymap.of([{ key: 'F12', run: (view) => (go(view.state.selection.main.head), true) }]),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        e.preventDefault();
        go(pos);
        return true;
      },
    }),
  ];
}

// ---- Breakpoints and the paused line ----

const setBreakpointLines = StateEffect.define<number[]>();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement('div');
    dot.className = 'cm-breakpoint';
    return dot;
  }
}
const breakpointMarker = new BreakpointMarker();

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointLines)) {
        const lines = [...new Set(e.value)].filter((l) => l >= 1 && l <= tr.state.doc.lines).sort((a, b) => a - b);
        set = RangeSet.of(lines.map((l) => breakpointMarker.range(tr.state.doc.line(l).from)));
      }
    }
    return set;
  },
});

export function breakpointLines(state: EditorState): number[] {
  const field = state.field(breakpointField, false);
  if (!field) return [];
  const lines: number[] = [];
  field.between(0, state.doc.length, (from) => void lines.push(state.doc.lineAt(from).number));
  return [...new Set(lines)];
}

export const setBreakpoints = (lines: number[]) => setBreakpointLines.of(lines);

function breakpoints(path: () => string | null, post: Post): Extension {
  const report = (state: EditorState) => {
    const file = path();
    if (file) post({ type: 'breakpointsChanged', path: file, lines: breakpointLines(state) });
  };
  return [
    breakpointField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => breakpointMarker,
      domEventHandlers: {
        mousedown(view, line) {
          const current = breakpointLines(view.state);
          const n = view.state.doc.lineAt(line.from).number;
          const next = current.includes(n) ? current.filter((l) => l !== n) : [...current, n];
          view.dispatch({ effects: setBreakpointLines.of(next) });
          report(view.state);
          return true;
        },
      },
    }),
    // Lines move when text above them is edited; tell the app where they went.
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      const before = breakpointLines(u.startState);
      const after = breakpointLines(u.state);
      if (before.join() !== after.join()) report(u.state);
    }),
  ];
}

const setExecLine = StateEffect.define<number | null>();

export const execLineEffect = (line: number | null) => setExecLine.of(line);

const execLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setExecLine)) continue;
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) deco = Decoration.none;
      else deco = Decoration.set([Decoration.line({ class: 'cm-execLine' }).range(tr.state.doc.line(e.value).from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Merge conflicts ----

export interface Conflict {
  // Line numbers (1-based) of the <<<<<<<, ======= and >>>>>>> markers.
  start: number;
  middle: number;
  end: number;
  // ||||||| from diff3 style, if present.
  base: number | null;
}

export function findConflicts(doc: Text): Conflict[] {
  const out: Conflict[] = [];
  let start: number | null = null;
  let base: number | null = null;
  let middle: number | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (text.startsWith('<<<<<<<')) {
      start = n;
      base = middle = null;
    } else if (start !== null && middle === null && text.startsWith('|||||||')) base = n;
    else if (start !== null && middle === null && /^=======$/.test(text.trimEnd())) middle = n;
    else if (start !== null && middle !== null && text.startsWith('>>>>>>>')) {
      out.push({ start, middle, end: n, base });
      start = base = middle = null;
    }
  }
  return out;
}

export type Resolution = 'current' | 'incoming' | 'both';

// The text that replaces lines start..end for a resolution.
export function resolveConflict(doc: Text, c: Conflict, choice: Resolution): { from: number; to: number; insert: string } {
  const lines = (a: number, b: number) => {
    const out: string[] = [];
    for (let n = a; n <= b; n++) out.push(doc.line(n).text);
    return out;
  };
  const current = lines(c.start + 1, (c.base ?? c.middle) - 1);
  const incoming = lines(c.middle + 1, c.end - 1);
  const keep = choice === 'current' ? current : choice === 'incoming' ? incoming : [...current, ...incoming];
  const from = doc.line(c.start).from;
  const endLine = doc.line(c.end);
  // The newline after the end marker goes too, and comes back after the kept lines.
  const newline = endLine.to < doc.length;
  const to = newline ? endLine.to + 1 : endLine.to;
  const insert = keep.length ? keep.join('\n') + (newline ? '\n' : '') : '';
  return { from, to, insert };
}

class ConflictActions extends WidgetType {
  constructor(readonly conflict: Conflict) {
    super();
  }
  eq(other: ConflictActions) {
    return other.conflict.start === this.conflict.start && other.conflict.end === this.conflict.end;
  }
  toDOM(view: EditorView) {
    const bar = document.createElement('div');
    bar.className = 'cm-conflict-actions';
    const choices: [Resolution, string][] = [
      ['current', 'Accept current'],
      ['incoming', 'Accept incoming'],
      ['both', 'Accept both'],
    ];
    for (const [choice, label] of choices) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onmousedown = (e) => {
        e.preventDefault();
        // Markers may have moved since the widget was drawn; find this conflict again.
        const now = findConflicts(view.state.doc).find((c) => c.start === this.conflict.start) ?? null;
        if (now) view.dispatch({ changes: resolveConflict(view.state.doc, now, choice), userEvent: 'input.conflict' });
      };
      bar.appendChild(b);
    }
    return bar;
  }
  ignoreEvent() {
    return false;
  }
}

function conflictDecorations(doc: Text): DecorationSet {
  const ranges = [];
  for (const c of findConflicts(doc)) {
    ranges.push(Decoration.widget({ widget: new ConflictActions(c), side: -1, block: true }).range(doc.line(c.start).from));
    for (let n = c.start; n <= c.end; n++) {
      const cls =
        n === c.start || n === c.middle || n === c.end || n === c.base
          ? 'cm-conflict-marker'
          : n < (c.base ?? c.middle)
            ? 'cm-conflict-current'
            : n > c.middle
              ? 'cm-conflict-incoming'
              : 'cm-conflict-base';
      ranges.push(Decoration.line({ class: cls }).range(doc.line(n).from));
    }
  }
  return Decoration.set(ranges, true);
}

// A state field, not a view plugin: CodeMirror only takes block widgets (the action bar) from state.
const conflicts = StateField.define<DecorationSet>({
  create: (state) => conflictDecorations(state.doc),
  update: (deco, tr) => (tr.docChanged ? conflictDecorations(tr.state.doc) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Putting it together ----

export function featureExtensions(features: EditorFeatures, path: () => string | null, post: Post, ask: Ask): Extension[] {
  const out: Extension[] = [execLineField];
  if (features.breakpoints) out.push(breakpoints(path, post));
  if (features.language) out.push(hover(path, ask), definition(path, post));
  if (features.conflicts) out.push(conflicts);
  return out;
}

export function lintDiagnostics(state: EditorState, items: EditorDiagnostic[]) {
  const len = state.doc.length;
  const diagnostics: Diagnostic[] = items.map((d) => {
    const from = Math.min(Math.max(0, d.from), len);
    return { from, to: Math.min(Math.max(from, d.to), len), severity: d.severity, message: d.message, source: d.source };
  });
  return setDiagnostics(state, diagnostics);
}

// The smallest single change that turns `from` into `to`, so cursor and undo history survive.
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endA = from.length;
  let endB = to.length;
  while (endA > start && endB > start && from.charCodeAt(endA - 1) === to.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: to.slice(start, endB) };
}
