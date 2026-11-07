// HTML from vscode-html-languageservice; <style> blocks go to the CSS service.
import { getLanguageService, TextDocument } from 'vscode-html-languageservice';

import { cssView, embeddedRegions, rankBoosts, regionAt, toCompletion, toHover, uriFor } from './adapters';
import { cssService } from './css';
import type { LanguageService } from './types';

const service = getLanguageService();
const css = cssService('css');

// The style bodies at their real offsets, for the CSS service.
let lastStyles: { text: string; css: string | null } | null = null;
function styles(text: string): string | null {
  if (lastStyles?.text === text) return lastStyles.css;
  const regions = embeddedRegions(text);
  const view = regions.some((r) => r.kind === 'css') ? cssView(text, regions) : null;
  lastStyles = { text, css: view };
  return view;
}

const docFor = (path: string, text: string) => TextDocument.create(uriFor(path), 'html', 0, text);

export const htmlService: LanguageService = {
  async complete(path, text, offset) {
    const region = regionAt(embeddedRegions(text), offset);
    if (region?.kind === 'css') return css.complete(path, styles(text)!, offset);
    // Scripts are left to IntelliSense or the word list.
    if (region?.kind === 'js') return null;
    const doc = docFor(path, text);
    const list = service.doComplete(doc, doc.positionAt(offset), service.parseHTMLDocument(doc));
    if (!list.items.length) return null;
    const start = offset - (/[\w-]*$/.exec(text.slice(Math.max(0, offset - 200), offset))?.[0].length ?? 0);
    const boosts = rankBoosts(list.items);
    return list.items.map((item, i) => toCompletion(item, doc, offset, start, boosts[i]));
  },
  async hover(path, text, offset) {
    const region = regionAt(embeddedRegions(text), offset);
    if (region?.kind === 'css') return css.hover(path, styles(text)!, offset);
    if (region?.kind === 'js') return null;
    const doc = docFor(path, text);
    const h = service.doHover(doc, doc.positionAt(offset), service.parseHTMLDocument(doc), { references: false });
    return h ? toHover(h, doc, offset) : null;
  },
  async validate(path, text) {
    const view = styles(text);
    return view ? css.validate(path, view) : [];
  },
  colors(path, text) {
    const view = styles(text);
    return view ? css.colors(path, view) : [];
  },
  presentations(path, text, color, from, to) {
    const view = styles(text);
    return view ? css.presentations(path, view, color, from, to) : [];
  },
};
