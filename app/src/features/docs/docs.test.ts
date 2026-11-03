import { createMemoryFs } from '../files/memoryFs';
import { createDocs, DocInfo, DOCS_LIST_URL, pickOffered, resolveLink, rewriteLinks, searchEntries, wordAt } from './docs';

const LIST: DocInfo[] = [
  { name: 'Python', slug: 'python~3.12', version: '3.12', release: '3.12.4', mtime: 1, db_size: 100 },
  { name: 'Python', slug: 'python~3.13', version: '3.13', release: '3.13.1', mtime: 2, db_size: 120 },
  { name: 'Python', slug: 'python~3.9', version: '3.9', release: '3.9.0', mtime: 3, db_size: 90 },
  { name: 'JavaScript', slug: 'javascript', mtime: 5, db_size: 50, attribution: '© MDN contributors' },
  { name: 'Haskell', slug: 'haskell', mtime: 5, db_size: 50 },
];

const INDEX = {
  entries: [
    { name: 'Array.prototype.map()', path: 'global_objects/array/map', type: 'Array' },
    { name: 'Map', path: 'global_objects/map', type: 'Map' },
    { name: 'Map.prototype.get()', path: 'global_objects/map/get', type: 'Map' },
    { name: 'WeakMap', path: 'global_objects/weakmap', type: 'WeakMap' },
  ],
};
const DB = { 'global_objects/map': '<h1>Map</h1><a href="map/get">get</a>', 'global_objects/array/map': '<h1>map</h1>' };

function fakeFetch(fail = false) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const body = url === DOCS_LIST_URL ? LIST : url.includes('/index.json') ? INDEX : url.includes('/db.json') ? (fail ? '{"cut' : DB) : null;
    return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetch, calls };
}

describe('offline docs', () => {
  it('offers the newest version of each doc Tide lists', () => {
    expect(pickOffered(LIST).map((d) => d.slug)).toEqual(['javascript', 'python~3.13']);
  });

  it('ranks exact names, then prefixes, then word starts', () => {
    expect(searchEntries(INDEX.entries, 'map').map((e) => e.name)).toEqual(['Map', 'Map.prototype.get()', 'Array.prototype.map()', 'WeakMap']);
    expect(searchEntries(INDEX.entries, '  ')).toEqual([]);
  });

  it('takes the word at the cursor for a lookup', () => {
    const text = 'const xs = items.map((x) => x.$id);';
    expect(wordAt(text, text.indexOf('map') + 1)).toBe('map');
    expect(wordAt(text, text.indexOf('items'))).toBe('items');
    expect(wordAt(text, text.indexOf('$id') + 3)).toBe('$id');
    expect(wordAt(text, text.indexOf('(('))).toBe('map');
    expect(wordAt('a + b', 2)).toBe('');
  });

  it('resolves links within a doc', () => {
    expect(resolveLink('global_objects/map', 'map/get')).toBe('global_objects/map/get');
    expect(resolveLink('global_objects/array/map', '../map')).toBe('global_objects/map');
    expect(resolveLink('global_objects/map', '#syntax')).toBe('global_objects/map#syntax');
    expect(resolveLink('global_objects/map', 'https://example.com')).toBeNull();
    const html = '<a href="map/get">get</a> <a href="#syntax">s</a> <a href="https://mdn.io">mdn</a>';
    expect(rewriteLinks(html, 'global_objects/map')).toBe('<a href="tide-doc:global_objects%2Fmap%2Fget">get</a> <a href="#syntax">s</a> <a href="https://mdn.io">mdn</a>');
  });

  it('downloads a doc, then searches and reads it offline, and removes it', async () => {
    const fs = createMemoryFs();
    const { fetch, calls } = fakeFetch();
    const docs = createDocs(fs, fetch, () => 42);
    const [js] = await docs.available();
    const meta = await docs.install(js);
    expect(meta).toMatchObject({ slug: 'javascript', entries: 4, installedAt: 42 });
    expect(calls).toContain('https://documents.devdocs.io/javascript/db.json?5');

    const offline = createDocs(fs, async () => Promise.reject(new Error('offline')));
    expect((await offline.installed()).map((d) => d.name)).toEqual(['JavaScript']);
    const [first] = await offline.search(['javascript'], 'map');
    expect(first).toMatchObject({ name: 'Map', slug: 'javascript' });
    expect(await offline.page('javascript', 'global_objects/map#description')).toContain('<h1>Map</h1>');
    expect(await offline.page('javascript', 'nope')).toBeNull();

    await offline.remove('javascript');
    expect(await offline.installed()).toEqual([]);
  });

  it("doesn't keep a cut-off download", async () => {
    const fs = createMemoryFs();
    const docs = createDocs(fs, fakeFetch(true).fetch);
    const [js] = await docs.available();
    await expect(docs.install(js)).rejects.toThrow();
    expect(await docs.installed()).toEqual([]);
  });
});

