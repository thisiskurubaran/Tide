// Offline documentation from DevDocs (devdocs.io, by freeCodeCamp): each doc is
// downloaded once as its index (names → pages) and database (page → HTML) and
// then searched and read without a network. Stored under .tide/docs/<slug>/.
import { FsAdapter, joinPath } from '../files/fs';
import { STATE_DIR } from '../../state/storage';

export const DOCS_LIST_URL = 'https://devdocs.io/docs.json';
export const DOCS_ORIGIN = 'https://documents.devdocs.io';

// What Tide offers, by DevDocs name; the newest version of each is used.
export const OFFERED = ['JavaScript', 'HTML', 'CSS', 'DOM', 'Node.js', 'Python', 'TypeScript', 'React', 'Git', 'Bash', 'HTTP', 'Lua', 'Ruby', 'PHP', 'SQLite', 'PostgreSQL'];

export interface DocInfo {
  name: string;
  slug: string;
  version?: string;
  release?: string;
  mtime: number;
  db_size: number;
  attribution?: string;
}

export interface DocEntry {
  name: string;
  path: string;
  type: string;
}

export interface InstalledDoc extends DocInfo {
  entries: number;
  installedAt: number;
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const dir = (slug: string) => joinPath(STATE_DIR, 'docs', slug.replace(/[^\w.~-]/g, '_'));
const versionKey = (d: DocInfo) => (d.release ?? d.version ?? '').split(/[^\d]+/).filter(Boolean).map(Number);
const newer = (a: DocInfo, b: DocInfo) => {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return a.mtime > b.mtime;
};

// The newest version of each offered doc, in the order Tide lists them.
export function pickOffered(all: DocInfo[]): DocInfo[] {
  const best = new Map<string, DocInfo>();
  for (const d of all) {
    if (!OFFERED.includes(d.name)) continue;
    const seen = best.get(d.name);
    if (!seen || newer(d, seen)) best.set(d.name, d);
  }
  return OFFERED.map((n) => best.get(n)).filter((d): d is DocInfo => !!d);
}

// Exact, then prefix, then word start, then anywhere; shorter names first.
export function searchEntries(entries: DocEntry[], query: string, limit = 100): DocEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { e: DocEntry; score: number }[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    const i = n.indexOf(q);
    if (i < 0) continue;
    const score = n === q ? 0 : i === 0 ? 1 : /[\s.:#(_-]/.test(n[i - 1]) ? 2 : 3;
    scored.push({ e, score: score * 1000 + n.length });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.e);
}

// "global_objects/array/map#syntax" → "global_objects/array/map".
export const pageKey = (path: string) => path.split('#')[0];

// Turns a link inside a page into a path in the same doc, or null for links
// that leave it (http, mailto…). Links are relative to the page's folder.
export function resolveLink(fromPath: string, href: string): string | null {
  if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('//')) return null;
  if (href.startsWith('#')) return `${pageKey(fromPath)}${href}`;
  const base = pageKey(fromPath).split('/').slice(0, -1);
  for (const part of href.split('/')) {
    if (part === '..') base.pop();
    else if (part && part !== '.') base.push(part);
  }
  return base.join('/');
}

// The identifier at an offset, for "Look up in docs": letters, digits, _ and $.
export function wordAt(text: string, offset: number): string {
  const isWord = (c: string | undefined) => !!c && /[\w$]/.test(c);
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  return text.slice(start, end);
}

export const DOC_LINK = 'tide-doc:';

// Links within the doc go to tide-doc:<path>, so the reader opens them itself.
export function rewriteLinks(html: string, fromPath: string): string {
  return html.replace(/\shref="([^"]*)"/g, (all, href: string) => {
    if (href.startsWith('#')) return all;
    const path = resolveLink(fromPath, href.replace(/&amp;/g, '&'));
    return path === null ? all : ` href="${DOC_LINK}${encodeURIComponent(path)}"`;
  });
}

export function createDocs(fs: FsAdapter, fetchImpl: Fetch, now: () => number = Date.now) {
  const indexes = new Map<string, DocEntry[]>();
  const dbs = new Map<string, Record<string, string>>();

  async function getJson(url: string) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`DevDocs answered ${res.status} for ${url}`);
    return res.json();
  }

  async function installed(): Promise<InstalledDoc[]> {
    const root = joinPath(STATE_DIR, 'docs');
    if ((await fs.stat(root)) !== 'dir') return [];
    const out: InstalledDoc[] = [];
    for (const e of await fs.readDir(root)) {
      const meta = joinPath(root, e.name, 'meta.json');
      if (e.kind === 'dir' && (await fs.stat(meta)) === 'file') out.push(JSON.parse(await fs.readFile(meta)));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function index(slug: string): Promise<DocEntry[]> {
    if (!indexes.has(slug)) indexes.set(slug, (JSON.parse(await fs.readFile(joinPath(dir(slug), 'index.json'))) as { entries: DocEntry[] }).entries);
    return indexes.get(slug)!;
  }

  return {
    async available(): Promise<DocInfo[]> {
      return pickOffered((await getJson(DOCS_LIST_URL)) as DocInfo[]);
    },
    installed,
    async install(doc: DocInfo, onProgress?: (step: 'index' | 'pages') => void): Promise<InstalledDoc> {
      onProgress?.('index');
      const idx = (await getJson(`${DOCS_ORIGIN}/${doc.slug}/index.json?${doc.mtime}`)) as { entries: DocEntry[] };
      onProgress?.('pages');
      const res = await fetchImpl(`${DOCS_ORIGIN}/${doc.slug}/db.json?${doc.mtime}`);
      if (!res.ok) throw new Error(`DevDocs answered ${res.status} for ${doc.name}`);
      const db = await res.text();
      JSON.parse(db); // Refuse a cut-off download before anything is written.
      await fs.writeFile(joinPath(dir(doc.slug), 'index.json'), JSON.stringify({ entries: idx.entries }));
      await fs.writeFile(joinPath(dir(doc.slug), 'db.json'), db);
      const meta: InstalledDoc = { ...doc, entries: idx.entries.length, installedAt: now() };
      await fs.writeFile(joinPath(dir(doc.slug), 'meta.json'), JSON.stringify(meta));
      indexes.delete(doc.slug);
      dbs.delete(doc.slug);
      return meta;
    },
    async remove(slug: string) {
      indexes.delete(slug);
      dbs.delete(slug);
      await fs.remove(dir(slug));
    },
    index,
    // Across the given docs; each result says which doc it's from.
    async search(slugs: string[], query: string, limit = 100): Promise<(DocEntry & { slug: string })[]> {
      const all: (DocEntry & { slug: string })[] = [];
      for (const slug of slugs) for (const e of await index(slug)) all.push({ ...e, slug });
      return searchEntries(all, query, limit) as (DocEntry & { slug: string })[];
    },
    async page(slug: string, path: string): Promise<string | null> {
      if (!dbs.has(slug)) dbs.set(slug, JSON.parse(await fs.readFile(joinPath(dir(slug), 'db.json'))));
      return dbs.get(slug)![pageKey(path)] ?? null;
    },
  };
}

export type Docs = ReturnType<typeof createDocs>;
