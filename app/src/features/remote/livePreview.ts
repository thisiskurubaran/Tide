// Preview helpers: device widths, and live reload that swaps stylesheets in
// place when only CSS changed and otherwise reloads where you were scrolled to.
import type { BuffersState } from '../../state/buffers';
import { splitKey } from '../../state/buffers';

export type ViewportId = 'fit' | 'phone' | 'tablet' | 'desktop';

export const VIEWPORTS: { id: ViewportId; label: string; width: number | null }[] = [
  { id: 'fit', label: 'Fit', width: null },
  { id: 'phone', label: 'Phone', width: 390 },
  { id: 'tablet', label: 'Tablet', width: 820 },
  { id: 'desktop', label: 'Desktop', width: 1280 },
];

// How to show a page meant for `width` in `available` points: narrower ones get
// a narrower frame; wider ones render at that width, scaled down by the page's
// viewport (`pageWidth`).
export function layoutFor(width: number | null, available: number): { frame: number | null; pageWidth: number | null } {
  if (width === null) return { frame: null, pageWidth: null };
  return width <= available ? { frame: width, pageWidth: null } : { frame: null, pageWidth: width };
}

// Files of `project` whose saved text changed between two buffer states.
export function savedPaths(prev: BuffersState['buffers'], next: BuffersState['buffers'], project: string): string[] {
  const out: string[] = [];
  for (const [key, b] of Object.entries(next)) {
    const [p, path] = splitKey(key);
    if (p === project && prev[key] && prev[key].saved !== b.saved) out.push(path);
  }
  return out;
}

export const onlyStyles = (paths: string[]) => paths.length > 0 && paths.every((p) => /\.(css)$/i.test(p));

// Re-fetches same-origin stylesheets with a cache-busting query, so the page
// keeps its state (form input, scroll, JS state) while styles update.
export const SWAP_CSS_SCRIPT = String.raw`(function () {
  var links = document.querySelectorAll('link[rel~="stylesheet"][href]');
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    try {
      var u = new URL(l.href, location.href);
      if (u.origin !== location.origin) continue;
      u.searchParams.set('tide-reload', String(Date.now()));
      var next = l.cloneNode();
      next.href = u.toString();
      next.onload = (function (old) { return function () { old.remove(); }; })(l);
      l.parentNode.insertBefore(next, l.nextSibling);
    } catch (e) {}
  }
})();true;`;

// A reload that comes back to the same scroll position.
export const RELOAD_KEEPING_SCROLL_SCRIPT = String.raw`(function () {
  try { sessionStorage.setItem('__tideScroll', JSON.stringify([scrollX, scrollY])); } catch (e) {}
  location.reload();
})();true;`;

// Runs before each page loads: puts the scroll back after a live reload, and
// applies the chosen device width.
export function pageSetupScript(pageWidth: number | null): string {
  return String.raw`(function () {
  var width = ${pageWidth === null ? 'null' : String(Math.round(pageWidth))};
  // Remembers the page's own viewport the first time it's overridden.
  function apply() {
    if (!document.head) return;
    var m = document.querySelector('meta[name="viewport"]');
    if (!width) {
      if (m && m.__tideOriginal !== undefined) {
        if (m.__tideOriginal === null) m.remove();
        else m.setAttribute('content', m.__tideOriginal);
      }
      return;
    }
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; m.__tideOriginal = null; document.head.appendChild(m); }
    if (m.__tideOriginal === undefined) m.__tideOriginal = m.getAttribute('content');
    m.setAttribute('content', 'width=' + width);
  }
  document.addEventListener('DOMContentLoaded', apply);
  window.__tideViewport = function (w) { width = w; apply(); };
  window.addEventListener('load', function () {
    try {
      var s = sessionStorage.getItem('__tideScroll');
      if (s) { sessionStorage.removeItem('__tideScroll'); var p = JSON.parse(s); scrollTo(p[0], p[1]); }
    } catch (e) {}
  });
})();`;
}

export const setViewportScript = (pageWidth: number | null) => `window.__tideViewport && window.__tideViewport(${pageWidth === null ? 'null' : Math.round(pageWidth)});true;`;
