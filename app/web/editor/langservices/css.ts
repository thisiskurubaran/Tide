// CSS, SCSS and LESS from vscode-css-languageservice.
import {
  getCSSLanguageService,
  getLESSLanguageService,
  getSCSSLanguageService,
  LanguageService as CSSService,
  Stylesheet,
  TextDocument,
} from 'vscode-css-languageservice';

import { rankBoosts, toCompletion, toDiagnostics, toHover, uriFor } from './adapters';
import type { LanguageService } from './types';

export type CSSKind = 'css' | 'scss' | 'less';

const settings = {
  validate: true,
  // Tailwind and PostCSS add their own at-rules (@tailwind, @apply); not worth a warning.
  lint: { unknownAtRules: 'ignore' as const },
  completion: { triggerPropertyValueCompletion: true, completePropertyWithSemicolon: true },
  // No browser to open the MDN links in.
  hover: { references: false },
};

const services: Partial<Record<CSSKind, CSSService>> = {};
function service(kind: CSSKind): CSSService {
  let s = services[kind];
  if (!s) {
    s = kind === 'scss' ? getSCSSLanguageService() : kind === 'less' ? getLESSLanguageService() : getCSSLanguageService();
    s.configure(settings);
    services[kind] = s;
  }
  return s;
}

// The last parse, reused while the text is unchanged (hover, colors and lint all ask in a row).
let last: { kind: CSSKind; uri: string; text: string; doc: TextDocument; sheet: Stylesheet } | null = null;
function parse(kind: CSSKind, path: string, text: string) {
  const uri = uriFor(path);
  if (last && last.kind === kind && last.uri === uri && last.text === text) return last;
  const doc = TextDocument.create(uri, kind, 0, text);
  last = { kind, uri, text, doc, sheet: service(kind).parseStylesheet(doc) };
  return last;
}

export function cssService(kind: CSSKind): LanguageService {
  return {
    async complete(path, text, offset) {
      const { doc, sheet } = parse(kind, path, text);
      const list = service(kind).doComplete(doc, doc.positionAt(offset), sheet, settings.completion);
      if (!list.items.length) return null;
      const start = offset - (/[\w-]*$/.exec(text.slice(Math.max(0, offset - 200), offset))?.[0].length ?? 0);
      const boosts = rankBoosts(list.items);
      return list.items.map((item, i) => toCompletion(item, doc, offset, start, boosts[i]));
    },
    async hover(path, text, offset) {
      const { doc, sheet } = parse(kind, path, text);
      const h = service(kind).doHover(doc, doc.positionAt(offset), sheet, settings.hover);
      return h ? toHover(h, doc, offset) : null;
    },
    async validate(path, text) {
      const { doc, sheet } = parse(kind, path, text);
      return toDiagnostics(service(kind).doValidation(doc, sheet, settings), doc, kind);
    },
    colors(path, text) {
      const { doc, sheet } = parse(kind, path, text);
      return service(kind)
        .findDocumentColors(doc, sheet)
        .map((c) => ({ from: doc.offsetAt(c.range.start), to: doc.offsetAt(c.range.end), color: c.color }));
    },
    presentations(path, text, color, from, to) {
      const { doc, sheet } = parse(kind, path, text);
      const range = { start: doc.positionAt(from), end: doc.positionAt(to) };
      return service(kind)
        .getColorPresentations(doc, sheet, color, range)
        .map((p) => p.textEdit?.newText ?? p.label);
    },
  };
}
