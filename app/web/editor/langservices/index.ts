// Built-in language smarts for CSS/SCSS/LESS, HTML and JSON: completions,
// hover, validation and color swatches, from the VS Code language services
// running in the WebView. Each service loads the first time a file of its
// language opens, so JS-only sessions don't pay for parsing them.
import {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
  pickedCompletion,
  snippet,
  startCompletion,
} from '@codemirror/autocomplete';
import { EditorState, Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, hoverTooltip, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';

import type { EditorDiagnostic } from '../../../src/features/editor/bridge';
import { LARGE_CHARS } from '../../../src/features/editor/largeFiles';
import { cssColor, embeddedRegions, hexColor, parseHex, regionAt, RGBA, samePresentation, ServiceCompletion, ServiceKind } from './adapters';
import type { LanguageService } from './types';

export type { ServiceKind } from './adapters';
export { serviceKind } from './adapters';

const LINT_DELAY_MS = 400;
const COLOR_DELAY_MS = 250;

const loaders: Record<ServiceKind, () => Promise<LanguageService>> = {
  css: () => import('./css').then((m) => m.cssService('css')),
  scss: () => import('./css').then((m) => m.cssService('scss')),
  less: () => import('./css').then((m) => m.cssService('less')),
  html: () => import('./html').then((m) => m.htmlService),
  json: () => import('./json').then((m) => m.jsonService),
};
const loaded = new Map<ServiceKind, Promise<LanguageService>>();
// Services that finished loading, for code that can't wait (the color picker).
const ready = new Map<ServiceKind, LanguageService>();
function load(kind: ServiceKind) {
  let p = loaded.get(kind);
  if (!p) {
    p = loaders[kind]().then((s) => (ready.set(kind, s), s));
    loaded.set(kind, p);
  }
  return p;
}

export interface ServiceHost {
  // The open file's service, or null (other languages, large files).
  kind(): ServiceKind | null;
  path(): string | null;
  // Validation results for `path`; the caller merges them with the app's diagnostics.
  diagnostics(path: string, items: EditorDiagnostic[]): void;
}

const tooBig = (state: EditorState) => state.doc.length > LARGE_CHARS;

// ---- Completions ----

// When to ask without Ctrl-Space: while typing a word, and after the
// characters each language completes on (":" for CSS values, "<" for tags...).
const TRIGGERS: Record<ServiceKind, RegExp> = {
  css: /[\w\-@:!#]$|: $/,
  scss: /[\w\-@:!#$]$|: $/,
  less: /[\w\-@:!#]$|: $/,
  html: /[\w\-<"'=/&]$|[\w"'] $/,
  json: /[\w"\-:]$|: $/,
};

function toOption(c: ServiceCompletion, pos: number): Completion {
  return {
    label: c.label,
    displayLabel: c.displayLabel,
    type: c.type,
    detail: c.detail,
    info: c.info,
    boost: c.boost,
    apply(view, completion, _from, to) {
      // The item's own range, stretched by whatever was typed since it was computed.
      const end = Math.max(to, c.to + (to - pos));
      if (c.snippet) snippet(c.insert)(view, completion, c.from, end);
      else
        view.dispatch({
          changes: { from: c.from, to: end, insert: c.insert },
          selection: { anchor: c.from + c.insert.length },
          annotations: pickedCompletion.of(completion),
          userEvent: 'input.complete',
        });
      if (c.retrigger) setTimeout(() => startCompletion(view), 0);
    },
  };
}

// Wraps the editor's completion source: files with a built-in service get
// its answers; everything else (and <script> in HTML) goes to `fallback`.
export function serviceCompletions(host: ServiceHost, fallback: CompletionSource): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const kind = host.kind();
    const path = host.path();
    if (!kind || !path || tooBig(context.state)) return fallback(context);
    const text = context.state.doc.toString();
    if (kind === 'html' && regionAt(embeddedRegions(text), context.pos)?.kind === 'js') return fallback(context);
    const before = context.state.sliceDoc(Math.max(0, context.pos - 2), context.pos);
    if (!context.explicit && !TRIGGERS[kind].test(before)) return null;
    const service = await load(kind);
    const items = await service.complete(path, text, context.pos);
    if (context.aborted) return null;
    if (!items?.length) return kind === 'html' ? fallback(context) : null;
    // Items share a start in practice (the word, or the quoted key in JSON).
    const from = Math.min(context.pos, items[0].from);
    return {
      from,
      options: items.map((c) => toOption(c, context.pos)),
      // JSON items span quotes and colons, so they're recomputed as you type.
      validFor: kind === 'json' ? undefined : /^[\w-]*$/,
    };
  };
}

// ---- Hover ----

function hover(host: ServiceHost) {
  return hoverTooltip(async (view, pos) => {
    const kind = host.kind();
    const path = host.path();
    if (!kind || !path || tooBig(view.state)) return null;
    const service = await load(kind);
    const h = await service.hover(path, view.state.doc.toString(), pos);
    if (!h) return null;
    return {
      pos: h.from,
      end: h.to,
      above: true,
      create() {
        // Same look as IntelliSense hovers: code on top, docs below.
        const dom = document.createElement('div');
        dom.className = 'cm-tide-hover';
        if (h.code) {
          const code = document.createElement('pre');
          code.textContent = h.code;
          dom.appendChild(code);
        }
        if (h.text) {
          const doc = document.createElement('div');
          doc.className = 'cm-tide-hover-doc';
          doc.textContent = h.text;
          dom.appendChild(doc);
        }
        return { dom };
      },
    };
  });
}

// ---- Validation ----

function validation(host: ServiceHost) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      constructor(readonly view: EditorView) {
        this.schedule(0);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.schedule(LINT_DELAY_MS);
      }
      schedule(delay: number) {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.run().catch((e) => console.warn('Validation failed', e));
        }, delay);
      }
      async run() {
        const path = host.path();
        if (!path) return;
        const kind = host.kind();
        const doc = this.view.state.doc;
        if (!kind || tooBig(this.view.state)) return host.diagnostics(path, []);
        const items = await (await load(kind)).validate(path, doc.toString());
        // Dropped if the text or the file changed meanwhile; the next run covers it.
        if (this.view.state.doc === doc && host.path() === path) host.diagnostics(path, items);
      }
      destroy() {
        if (this.timer !== null) clearTimeout(this.timer);
      }
    },
  );
}

// ---- Color swatches and the picker ----

const setColors = StateEffect.define<DecorationSet>();

const colorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setColors)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class Swatch extends WidgetType {
  constructor(
    readonly color: RGBA,
    readonly host: ServiceHost,
  ) {
    super();
  }
  eq(other: Swatch) {
    return cssColor(other.color) === cssColor(this.color);
  }
  toDOM(view: EditorView) {
    const box = document.createElement('span');
    box.className = 'cm-color-swatch';
    box.setAttribute('aria-label', 'Pick color');
    const fill = document.createElement('span');
    fill.style.backgroundColor = cssColor(this.color);
    box.appendChild(fill);
    box.onmousedown = (e) => {
      e.preventDefault();
      openPicker(view, box, this.color, this.host);
    };
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

// A native color input over the swatch: the system picker on iOS and
// Android, cheaper than drawing one. Alpha is kept as it was. It all runs
// synchronously in the tap, or WebKit won't open the picker.
function openPicker(view: EditorView, box: HTMLElement, color: RGBA, host: ServiceHost) {
  const kind = host.kind();
  const path = host.path();
  const service = kind && ready.get(kind);
  if (!service || !path) return;
  // The swatch sits right before its color text.
  const at = view.posAtDOM(box);
  const text = view.state.doc.toString();
  const hit = service.colors(path, text).find((c) => c.from === at);
  if (!hit) return;
  const original = text.slice(hit.from, hit.to);
  let span = { from: hit.from, to: hit.to };
  const input = document.createElement('input');
  input.type = 'color';
  input.value = hexColor(color);
  const rect = box.getBoundingClientRect();
  Object.assign(input.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.bottom}px`, width: '1px', height: '1px', opacity: '0', border: '0', padding: '0' });
  document.body.appendChild(input);
  input.addEventListener('input', () => {
    const next = parseHex(input.value, color.alpha);
    if (!next) return;
    const insert = samePresentation(original, service.presentations(path, view.state.doc.toString(), next, span.from, span.to));
    if (!insert) return;
    view.dispatch({ changes: { from: span.from, to: span.to, insert }, userEvent: 'input.color' });
    span = { from: span.from, to: span.from + insert.length };
  });
  const remove = () => input.remove();
  input.addEventListener('change', remove);
  input.addEventListener('blur', remove);
  input.click();
}

function colors(host: ServiceHost) {
  return [
    colorField,
    ViewPlugin.fromClass(
      class {
        timer: ReturnType<typeof setTimeout> | null = null;
        constructor(readonly view: EditorView) {
          this.schedule(0);
        }
        update(u: ViewUpdate) {
          if (u.docChanged) this.schedule(COLOR_DELAY_MS);
        }
        schedule(delay: number) {
          if (this.timer !== null) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = null;
            this.run().catch((e) => console.warn('Colors failed', e));
          }, delay);
        }
        async run() {
          const kind = host.kind();
          const path = host.path();
          if (!kind || !path || kind === 'json' || tooBig(this.view.state)) return;
          const doc = this.view.state.doc;
          const found = (await load(kind)).colors(path, doc.toString());
          if (this.view.state.doc !== doc) return;
          const deco = Decoration.set(found.map((c) => Decoration.widget({ widget: new Swatch(c.color, host), side: -1 }).range(c.from)));
          this.view.dispatch({ effects: setColors.of(deco) });
        }
        destroy() {
          if (this.timer !== null) clearTimeout(this.timer);
        }
      },
    ),
  ];
}

const swatchTheme = EditorView.baseTheme({
  '.cm-color-swatch': {
    display: 'inline-block',
    width: '0.8em',
    height: '0.8em',
    margin: '0 3px 0 1px',
    verticalAlign: 'middle',
    border: '1px solid #8888',
    borderRadius: '2px',
    cursor: 'pointer',
    // A checkerboard shows through translucent colors.
    background: 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 50% / 6px 6px',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  '.cm-color-swatch > span': { display: 'block', width: '100%', height: '100%' },
});

export function languageServices(host: ServiceHost): Extension {
  return [hover(host), validation(host), colors(host), swatchTheme];
}
