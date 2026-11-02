// Turns Markdown, Jupyter notebooks and JSON into an HTML page for the preview
// WebView. The page runs no scripts; local images are inlined by the caller.
import { marked } from 'marked';

export type PreviewKind = 'markdown' | 'notebook' | 'json' | 'sqlite' | 'http' | 'openapi';

export function previewKind(path: string): PreviewKind | null {
  if (/\.(md|markdown|mdx)$/i.test(path)) return 'markdown';
  // API specs by their usual names: openapi.yaml, swagger.json, petstore.openapi.yml…
  if (/(^|\/|\.)(openapi|swagger)[^/]*\.(ya?ml|json)$/i.test(path)) return 'openapi';
  if (/\.ipynb$/i.test(path)) return 'notebook';
  if (/\.(json|geojson|webmanifest)$/i.test(path)) return 'json';
  if (/\.(db|sqlite|sqlite3|db3)$/i.test(path)) return 'sqlite';
  if (/\.(http|rest)$/i.test(path)) return 'http';
  return null;
}

// Files that only make sense in their viewer (binary), so there's no source to switch to.
export const viewerOnly = (kind: PreviewKind | null) => kind === 'sqlite';

// Files that open in their viewer first; the rest open as source.
export const viewerFirst = (kind: PreviewKind | null) => kind === 'notebook' || kind === 'http' || kind === 'openapi' || viewerOnly(kind);

// Big documents are cut off after this many values, so the page stays responsive.
const JSON_MAX_NODES = 5000;
// Levels open when the tree first shows.
const JSON_OPEN_DEPTH = 2;

// A collapsible tree for JSON, built from <details> so it works without scripts.
export function jsonToHtml(source: string): string {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return `<p class="err">This JSON can't be parsed: ${escapeHtml(message)}</p><p class="note">Switch to the source to fix it.</p>`;
  }
  let nodes = 0;
  const scalar = (v: unknown) => {
    if (v === null) return '<span class="j-null">null</span>';
    if (typeof v === 'string') return `<span class="j-str">"${escapeHtml(v)}"</span>`;
    if (typeof v === 'number') return `<span class="j-num">${v}</span>`;
    return `<span class="j-bool">${String(v)}</span>`;
  };
  const render = (v: unknown, key: string | null, depth: number): string => {
    if (++nodes > JSON_MAX_NODES) return '';
    const label = key === null ? '' : `<span class="j-key">${escapeHtml(key)}</span>: `;
    if (v === null || typeof v !== 'object') return `<div class="j-row">${label}${scalar(v)}</div>`;
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
    const summary = Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`;
    if (entries.length === 0) return `<div class="j-row">${label}<span class="j-meta">${Array.isArray(v) ? '[]' : '{}'}</span></div>`;
    const children = entries.map(([k, x]) => render(x, k, depth + 1)).join('');
    return `<details${depth < JSON_OPEN_DEPTH ? ' open' : ''}><summary>${label}<span class="j-meta">${summary}</span></summary><div class="j-kids">${children}</div></details>`;
  };
  const tree = render(value, null, 0);
  const cut = nodes > JSON_MAX_NODES ? `<p class="note">Showing the first ${JSON_MAX_NODES.toLocaleString('en-US')} values. Switch to the source for the rest.</p>` : '';
  return `<div class="json">${tree}</div>${cut}`;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Tracebacks carry terminal colors.
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

// ```mermaid blocks become <pre class="mermaid">, which the preview draws as
// diagrams (see mermaidScripts); elsewhere they stay code.
export const markdownToHtml = (source: string) =>
  (marked.parse(source, { async: false, gfm: true }) as string).replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<pre class="mermaid">$1</pre>');

export const hasMermaid = (html: string) => html.includes('<pre class="mermaid">');

// The page runs only scripts carrying this page's nonce: Mermaid and the line
// that starts it, never scripts written in the document.
export interface PageScripts {
  nonce: string;
  scripts: string[];
}

export function mermaidScripts(library: string, dark: boolean, nonce: string): PageScripts {
  const init = `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${dark ? "'dark'" : "'default'"} }); mermaid.run({ querySelector: 'pre.mermaid' }).catch(function () {});`;
  return { nonce, scripts: [library, init] };
}

type Multiline = string | string[];
const text = (v: Multiline | undefined) => (Array.isArray(v) ? v.join('') : (v ?? ''));

interface Output {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error';
  name?: string;
  text?: Multiline;
  data?: Record<string, Multiline>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface Cell {
  cell_type: 'markdown' | 'code' | 'raw';
  source: Multiline;
  execution_count?: number | null;
  outputs?: Output[];
}

export interface Notebook {
  cells: Cell[];
  metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } };
}

function outputHtml(o: Output): string {
  if (o.output_type === 'stream') return `<pre class="out${o.name === 'stderr' ? ' err' : ''}">${escapeHtml(text(o.text))}</pre>`;
  if (o.output_type === 'error') return `<pre class="out err">${escapeHtml(stripAnsi((o.traceback ?? [`${o.ename}: ${o.evalue}`]).join('\n')))}</pre>`;
  const data = o.data ?? {};
  for (const type of ['image/png', 'image/jpeg', 'image/gif']) {
    if (data[type]) return `<img class="out" src="data:${type};base64,${text(data[type]).replace(/\s/g, '')}">`;
  }
  if (data['image/svg+xml']) return `<div class="out">${text(data['image/svg+xml'])}</div>`;
  if (data['text/html']) return `<div class="out">${text(data['text/html'])}</div>`;
  if (data['text/markdown']) return `<div class="out">${markdownToHtml(text(data['text/markdown']))}</div>`;
  if (data['text/plain']) return `<pre class="out">${escapeHtml(text(data['text/plain']))}</pre>`;
  return '';
}

export function notebookToHtml(json: string): string {
  let nb: Notebook;
  try {
    nb = JSON.parse(json);
    if (!Array.isArray(nb.cells)) throw new Error('no cells');
  } catch {
    return '<p class="note">This notebook could not be read. It may be from an old Jupyter version or still being written.</p>';
  }
  const language = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? '';
  return nb.cells
    .map((cell) => {
      const source = text(cell.source);
      if (cell.cell_type === 'markdown') return `<section class="cell md">${markdownToHtml(source)}</section>`;
      if (cell.cell_type === 'raw') return `<section class="cell"><pre>${escapeHtml(source)}</pre></section>`;
      const count = cell.execution_count ?? ' ';
      return `<section class="cell code"><div class="prompt">In [${count}]</div><pre class="src" data-lang="${escapeHtml(language)}"><code>${escapeHtml(source)}</code></pre>${(cell.outputs ?? []).map(outputHtml).join('')}</section>`;
    })
    .join('\n');
}

export interface PreviewColors {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  code: string;
  link: string;
  error: string;
}

export function previewPage(body: string, c: PreviewColors, fontSize: number, run?: PageScripts): string {
  const scripts = run ? run.scripts.map((s) => `<script nonce="${run.nonce}">${s.replace(/<\/script/gi, '<\\/script')}</script>`).join('') : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:${run ? `; script-src 'nonce-${run.nonce}'` : ''}">
<style>
body{margin:0;padding:16px 16px 48px;background:${c.background};color:${c.foreground};font:${fontSize}px/1.6 -apple-system,system-ui,sans-serif;word-wrap:break-word}
a{color:${c.link}}
h1,h2{border-bottom:1px solid ${c.border};padding-bottom:.3em}
code,pre{font-family:ui-monospace,Menlo,monospace;font-size:.9em}
code{background:${c.code};padding:.1em .3em;border-radius:4px}
pre{background:${c.code};padding:12px;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:${c.muted};border-left:3px solid ${c.border}}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border:1px solid ${c.border};padding:6px 10px}
img{max-width:100%}
hr{border:0;border-top:1px solid ${c.border}}
.cell{margin:0 0 16px}
.prompt{color:${c.muted};font:12px ui-monospace,Menlo,monospace;margin-bottom:4px}
.out{margin:8px 0 0}
pre.out{background:none;border-left:3px solid ${c.border};border-radius:0}
.err{color:${c.error}}
.note{color:${c.muted}}
.json{font:.9em/1.7 ui-monospace,Menlo,monospace}
.json details>summary{cursor:pointer;list-style:none}
.json details>summary::-webkit-details-marker{display:none}
.json details>summary::before{content:'\\25B8';display:inline-block;width:1em;color:${c.muted}}
.json details[open]>summary::before{content:'\\25BE'}
.j-kids{padding-left:1.1em;border-left:1px solid ${c.border};margin-left:.35em}
.j-row{padding-left:1em;white-space:pre-wrap;word-break:break-all}
.j-key{color:${c.link}}
.j-str{color:${c.foreground}}
.j-num,.j-bool,.j-null,.j-meta{color:${c.muted}}
pre.mermaid{background:none;text-align:center}
</style></head><body>${body}${scripts}</body></html>`;
}

// Relative image paths in the rendered HTML, resolved against the file's folder.
export function localImages(html: string, filePath: string): { src: string; path: string }[] {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const out: { src: string; path: string }[] = [];
  for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    const src = m[1];
    if (/^(https?:|data:|\/\/)/i.test(src)) continue;
    const parts: string[] = [];
    for (const p of [...dir.split('/'), ...decodeURI(src).split(/[?#]/)[0].split('/')]) {
      if (!p || p === '.') continue;
      if (p === '..') parts.pop();
      else parts.push(p);
    }
    out.push({ src, path: parts.join('/') });
  }
  return out;
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
export const imageType = (path: string) => IMAGE_TYPES[path.split('.').pop()!.toLowerCase()] ?? null;
