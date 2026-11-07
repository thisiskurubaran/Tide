// Page checks in the spirit of Lighthouse: accessibility, SEO, best practices
// and performance, worked out in the previewed page from its DOM and the
// Performance API. A heuristic subset, not a full audit; each check says what
// it looked at. Plain ES5-ish code in a string, as it runs in whatever page
// the server returns (and Hermes can't turn functions back into source).

export type AuditCategory = 'accessibility' | 'seo' | 'best-practices' | 'performance';

export interface AuditCheck {
  id: string;
  category: AuditCategory;
  title: string;
  ok: boolean;
  // Shown under the title, e.g. "3 images" or "1.2 s".
  detail?: string;
  // Up to a few elements or URLs that failed.
  items?: string[];
  // Informational checks don't count towards the score.
  info?: boolean;
}

export interface AuditReport {
  url: string;
  time: number;
  checks: AuditCheck[];
}

export const CATEGORIES: { id: AuditCategory; label: string }[] = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'seo', label: 'SEO' },
  { id: 'best-practices', label: 'Best practices' },
  { id: 'performance', label: 'Performance' },
];

// Share of scored checks passed, 0–100; null when a category has none.
export function categoryScore(checks: AuditCheck[], category: AuditCategory): number | null {
  const scored = checks.filter((c) => c.category === category && !c.info);
  if (scored.length === 0) return null;
  return Math.round((100 * scored.filter((c) => c.ok).length) / scored.length);
}

export const auditScript = (id: number) => `window.__tideAudit && window.__tideAudit(${id});true;`;

// Installed with the dev tools script; defines window.__tideAudit(id).
export const AUDIT_SCRIPT = String.raw`(function () {
  if (window.__tideAudit) return;
  var MAX_ITEMS = 5;
  function describe(el) {
    if (!el || !el.tagName) return String(el);
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    var text = (el.getAttribute('src') || el.getAttribute('href') || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) s += ' “' + text.slice(0, 40) + (text.length > 40 ? '…' : '') + '”';
    return s;
  }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function visible(el) {
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  }
  function name(el) {
    var label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (label.trim()) return label.trim();
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var t = by.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ');
      if (t.trim()) return t.trim();
    }
    if (el.id) {
      var lab = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    var wrap = el.closest && el.closest('label');
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    var imgs = el.querySelectorAll ? el.querySelectorAll('img[alt]') : [];
    for (var i = 0; i < imgs.length; i++) if (imgs[i].getAttribute('alt').trim()) return imgs[i].getAttribute('alt').trim();
    if (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) && el.value) return el.value;
    return (el.textContent || '').trim();
  }
  function rgb(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function background(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage !== 'none') return null;
      var c = rgb(st.backgroundColor);
      if (c && c.a >= 0.99) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function check(list, c, failed, detail) {
    c.ok = failed.length === 0;
    if (failed.length) c.items = failed.slice(0, MAX_ITEMS).map(describe);
    if (detail !== undefined) c.detail = detail;
    else if (failed.length) c.detail = failed.length + (failed.length === 1 ? ' element' : ' elements');
    list.push(c);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  window.__tideAudit = function (id) {
    var out = [];
    var html = document.documentElement;
    var vp = document.querySelector('meta[name="viewport"]');
    var vpContent = vp ? (vp.getAttribute('content') || '') : '';

    // Accessibility
    check(out, { id: 'img-alt', category: 'accessibility', title: 'Images have alt text' }, all('img').filter(function (i) { return !i.hasAttribute('alt'); }));
    check(out, { id: 'form-labels', category: 'accessibility', title: 'Form fields have labels' },
      all('input, select, textarea').filter(function (el) { return !/^(hidden|submit|button|reset|image)$/i.test(el.type || '') && visible(el) && !name(el) && !el.getAttribute('placeholder'); }));
    check(out, { id: 'button-name', category: 'accessibility', title: 'Buttons have a name' }, all('button, [role="button"]').filter(function (el) { return visible(el) && !name(el); }));
    check(out, { id: 'link-name', category: 'accessibility', title: 'Links have a name' }, all('a[href]').filter(function (el) { return visible(el) && !name(el); }));
    out.push({ id: 'html-lang', category: 'accessibility', title: 'The page says its language (<html lang>)', ok: !!html.getAttribute('lang'), detail: html.getAttribute('lang') || 'Missing' });
    var ids = {}, dup = [];
    all('[id]').forEach(function (el) { if (ids[el.id]) dup.push(el); ids[el.id] = true; });
    check(out, { id: 'duplicate-id', category: 'accessibility', title: 'IDs are unique' }, dup);
    var last = 0, skipped = [];
    all('h1, h2, h3, h4, h5, h6').forEach(function (h) { var l = +h.tagName[1]; if (last && l > last + 1) skipped.push(h); last = l; });
    check(out, { id: 'heading-order', category: 'accessibility', title: "Headings don't skip levels" }, skipped);
    var zoomOff = /user-scalable\s*=\s*(no|0)/i.test(vpContent) || /maximum-scale\s*=\s*(0?\.\d+|1(\.0+)?)\b/i.test(vpContent);
    check(out, { id: 'zoom', category: 'accessibility', title: 'Pinch to zoom is allowed' }, zoomOff ? [vp] : [], zoomOff ? vpContent : undefined);
    var low = [], looked = 0;
    var texts = all('p, span, a, li, td, th, label, button, h1, h2, h3, h4, h5, h6, small, strong, em, div');
    for (var i = 0; i < texts.length && looked < 400; i++) {
      var el = texts[i];
      var own = false;
      for (var k = 0; k < el.childNodes.length; k++) if (el.childNodes[k].nodeType === 3 && el.childNodes[k].textContent.trim()) { own = true; break; }
      if (!own || !visible(el)) continue;
      looked++;
      var st = getComputedStyle(el);
      var fg = rgb(st.color), bg = background(el);
      if (!fg || !bg || fg.a < 0.99) continue;
      var a = lum(fg), b = lum(bg);
      var ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      var size = parseFloat(st.fontSize), bold = parseInt(st.fontWeight, 10) >= 700;
      var large = size >= 24 || (bold && size >= 18.66);
      if (ratio < (large ? 3 : 4.5)) low.push(el);
    }
    check(out, { id: 'contrast', category: 'accessibility', title: 'Text has enough contrast (WCAG AA)' }, low);

    // SEO
    var title = (document.title || '').trim();
    out.push({ id: 'title', category: 'seo', title: 'The page has a title', ok: !!title, detail: title ? '“' + title.slice(0, 60) + '”' + (title.length > 60 ? ' is over 60 characters' : '') : 'Missing' });
    var desc = document.querySelector('meta[name="description"]');
    var d = desc ? (desc.getAttribute('content') || '').trim() : '';
    out.push({ id: 'description', category: 'seo', title: 'The page has a meta description', ok: !!d, detail: d ? plural(d.length, 'character', 'characters') + (d.length > 160 ? ', over 160' : '') : 'Missing' });
    out.push({ id: 'viewport', category: 'seo', title: 'The page has a mobile viewport', ok: /width\s*=\s*device-width/i.test(vpContent), detail: vpContent || 'No <meta name="viewport">' });
    var h1 = all('h1').length;
    out.push({ id: 'h1', category: 'seo', title: 'One main heading (h1)', ok: h1 === 1, detail: plural(h1, 'h1', 'h1s') });
    var robots = document.querySelector('meta[name="robots"]');
    var noindex = robots && /noindex/i.test(robots.getAttribute('content') || '');
    out.push({ id: 'indexable', category: 'seo', title: "Search engines aren't blocked", ok: !noindex, detail: noindex ? 'meta robots: ' + robots.getAttribute('content') : undefined });
    check(out, { id: 'link-text', category: 'seo', title: 'Links have descriptive text' }, all('a[href]').filter(function (el) { return /^(click here|here|more|read more|link)$/i.test((el.textContent || '').trim()); }));

    // Best practices
    out.push({ id: 'doctype', category: 'best-practices', title: 'The page has a doctype', ok: !!document.doctype, detail: document.doctype ? undefined : 'Without one, browsers use quirks mode' });
    out.push({ id: 'charset', category: 'best-practices', title: 'The character set is declared', ok: !!document.querySelector('meta[charset], meta[http-equiv="Content-Type" i]') });
    var insecure = location.protocol === 'https:' ? all('[src], link[href]').filter(function (el) { return /^http:/i.test(el.getAttribute('src') || el.getAttribute('href') || ''); }) : [];
    check(out, { id: 'mixed-content', category: 'best-practices', title: 'No insecure (http) resources on an https page' }, insecure);
    check(out, { id: 'noopener', category: 'best-practices', title: 'Links opening a new tab use rel="noopener"' }, all('a[target="_blank"]').filter(function (el) { return !/noopener|noreferrer/i.test(el.getAttribute('rel') || ''); }));
    check(out, { id: 'deprecated', category: 'best-practices', title: 'No deprecated HTML elements' }, all('marquee, center, font, blink, frameset, big, tt'));

    // Performance
    var nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    var t = performance.timing;
    var dcl = nav ? nav.domContentLoadedEventEnd : t && t.domContentLoadedEventEnd ? t.domContentLoadedEventEnd - t.navigationStart : 0;
    var load = nav ? nav.loadEventEnd : t && t.loadEventEnd ? t.loadEventEnd - t.navigationStart : 0;
    out.push({ id: 'dcl', category: 'performance', title: 'Content loaded quickly (under 1.5 s)', ok: !dcl || dcl < 1500, detail: dcl ? (dcl / 1000).toFixed(2) + ' s to DOMContentLoaded' : 'Not measured' });
    if (load) out.push({ id: 'load', category: 'performance', title: 'Page fully loaded in under 3 s', ok: load < 3000, detail: (load / 1000).toFixed(2) + ' s' });
    var blocking = all('head script[src]').filter(function (s) { return !s.async && !s.defer && s.type !== 'module'; });
    check(out, { id: 'render-blocking', category: 'performance', title: 'No render-blocking scripts in <head>' }, blocking, blocking.length ? plural(blocking.length, 'script', 'scripts') + ' without async or defer' : undefined);
    var big = all('img').filter(function (img) { return img.complete && img.naturalWidth && img.clientWidth && img.naturalWidth > img.clientWidth * 2.5 && img.naturalWidth > 600; });
    check(out, { id: 'image-size', category: 'performance', title: 'Images are not much bigger than shown' }, big);
    check(out, { id: 'image-dimensions', category: 'performance', title: 'Images have width and height (no layout shift)' }, all('img').filter(function (img) { return !img.getAttribute('width') || !img.getAttribute('height'); }));
    var nodes = document.getElementsByTagName('*').length;
    out.push({ id: 'dom-size', category: 'performance', title: 'DOM size is reasonable (under 1,500 elements)', ok: nodes < 1500, detail: plural(nodes, 'element', 'elements') });
    var res = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
    var bytes = 0;
    res.forEach(function (r) { bytes += r.transferSize || r.encodedBodySize || 0; });
    out.push({ id: 'requests', category: 'performance', title: 'Requests and transfer size', ok: true, info: true, detail: plural(res.length + 1, 'request', 'requests') + (bytes ? ', ' + (bytes / 1024).toFixed(0) + ' KB' : '') });

    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ __tide: true, kind: 'audit', id: id, url: location.href, checks: out, time: Date.now() }));
    } catch (e) {}
  };
})();`;
