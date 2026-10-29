import { unzipSync } from 'fflate';

import { cloudflareHash, contentType, deployCloudflare, deployGitHubPages, deployNetlify, deployRender, deployVercel } from './providers';

type Handler = (url: string, init: RequestInit) => { status?: number; body?: unknown };
function fakeFetch(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? 'GET', body });
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const files = [
  { path: 'index.html', base64: btoa('<h1>Hi</h1>') },
  { path: 'css/site.css', base64: btoa('h1{color:red}') },
];
const noop = () => undefined;

describe('deploy providers', () => {
  it('publishes to a new gh-pages branch and turns on Pages', async () => {
    let blob = 0;
    const { fetchImpl, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/git/ref/heads/gh-pages')) return { status: 404, body: { message: 'Not Found' } };
      if (url.endsWith('/git/blobs')) return { body: { sha: `b${++blob}` } };
      if (url.endsWith('/git/trees')) return { body: { sha: 'tree1' } };
      if (url.endsWith('/git/commits')) return { body: { sha: 'c1' } };
      if (url.endsWith('/git/refs')) return { body: {} };
      if (url.endsWith('/pages') && init.method === 'GET') return { status: 404 };
      if (url.endsWith('/pages')) return { body: { html_url: 'https://ada.github.io/site/' } };
      throw new Error(url);
    });
    const r = await deployGitHubPages(files, { owner: 'ada', repo: 'site', branch: 'gh-pages' }, 'tok', noop, fetchImpl);
    expect(r.url).toBe('https://ada.github.io/site/');
    expect(calls.filter((c) => c.url.endsWith('/git/blobs'))).toHaveLength(3);
    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body as { tree: { path: string }[] };
    expect(tree.tree.map((t) => t.path)).toEqual(['index.html', 'css/site.css', '.nojekyll']);
    expect(calls.find((c) => c.url.endsWith('/git/commits'))!.body).toMatchObject({ tree: 'tree1', parents: [] });
    expect(calls.find((c) => c.url.endsWith('/git/refs'))!.body).toEqual({ ref: 'refs/heads/gh-pages', sha: 'c1' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { source: { branch: 'gh-pages', path: '/' } } });
  });

  it('updates an existing gh-pages branch on top of its last commit', async () => {
    const { fetchImpl, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/git/ref/heads/gh-pages')) return { body: { object: { sha: 'old' } } };
      if (url.includes('/git/')) return { body: { sha: 'x' } };
      if (url.endsWith('/pages')) return { body: { html_url: 'https://ada.github.io/site/', source: { branch: 'gh-pages' } } };
      throw new Error(`${init.method} ${url}`);
    });
    await deployGitHubPages(files, { owner: 'ada', repo: 'site', branch: 'gh-pages' }, 'tok', noop, fetchImpl);
    expect(calls.find((c) => c.url.endsWith('/git/commits'))!.body).toMatchObject({ parents: ['old'] });
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ body: { sha: 'x', force: true } });
  });

  it('explains an empty repository', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 409, body: { message: 'Git Repository is empty.' } }));
    await expect(deployGitHubPages(files, { owner: 'a', repo: 'b', branch: 'gh-pages' }, 't', noop, fetchImpl)).rejects.toThrow('Push a first commit');
  });

  it('creates a Netlify site once and uploads a zip', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/sites')) return { body: { id: 'site1' } };
      if (url.endsWith('/sites/site1/deploys')) return { body: { id: 'd1', state: 'ready', ssl_url: 'https://calm-otter.netlify.app' } };
      throw new Error(url);
    });
    const r = await deployNetlify(files, undefined, 'tok', noop, fetchImpl);
    expect(r).toEqual({ url: 'https://calm-otter.netlify.app', config: { netlify: { siteId: 'site1' } } });
    const zip = unzipSync(calls[1].body as Uint8Array);
    expect(Object.keys(zip).sort()).toEqual(['css/site.css', 'index.html']);
    expect(new TextDecoder().decode(zip['index.html'])).toBe('<h1>Hi</h1>');
  });

  it('sends files inline to Vercel and returns the production alias', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { id: 'dpl', readyState: 'READY', url: 'site-abc.vercel.app', alias: ['site-git-main.vercel.app', 'site.vercel.app'] } }));
    const r = await deployVercel(files, 'site', 'tok', noop, fetchImpl);
    expect(r.url).toBe('https://site.vercel.app');
    expect(calls[0].body).toMatchObject({ name: 'site', target: 'production', files: [{ file: 'index.html', encoding: 'base64' }, { file: 'css/site.css' }] });
  });

  it('uploads only the files Cloudflare is missing', async () => {
    const indexHash = cloudflareHash(files[0].base64, 'index.html');
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/projects/site')) return { body: { result: { name: 'site' } } };
      if (url.endsWith('/upload-token')) return { body: { result: { jwt: 'jwt1' } } };
      if (url.endsWith('/check-missing')) return { body: { result: [indexHash] } };
      if (url.endsWith('/upload') || url.endsWith('/upsert-hashes')) return { body: { result: null } };
      if (url.endsWith('/deployments')) return { body: { result: { url: 'https://abc.site.pages.dev' } } };
      throw new Error(url);
    });
    const r = await deployCloudflare(files, { accountId: 'acc', project: 'site' }, 'tok', noop, fetchImpl);
    expect(r.url).toBe('https://site.pages.dev');
    const upload = calls.find((c) => c.url.endsWith('/upload'))!.body as { key: string; metadata: { contentType: string } }[];
    expect(upload).toEqual([{ key: indexHash, value: files[0].base64, metadata: { contentType: 'text/html' }, base64: true }]);
    expect(cloudflareHash('abc', 'a.css')).toMatch(/^[0-9a-f]{32}$/);
    expect(cloudflareHash('abc', 'a.css')).not.toBe(cloudflareHash('abc', 'a.js'));
  });

  it('triggers a Render deploy hook, and rejects other URLs', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { deploy: { id: 'dep' } } }));
    await deployRender('https://api.render.com/deploy/srv-1?key=abc', noop, fetchImpl);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.render.com/deploy/srv-1?key=abc' });
    await expect(deployRender('https://example.com', noop, fetchImpl)).rejects.toThrow('deploy hook');
  });

  it('knows common content types', () => {
    expect(contentType('a/b.woff2')).toBe('font/woff2');
    expect(contentType('x.unknown')).toBe('application/octet-stream');
  });
});
