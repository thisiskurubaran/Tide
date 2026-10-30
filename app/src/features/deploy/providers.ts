// Publishing a folder of the project as a website. Each provider talks to its
// service's HTTP API with the user's own token; Tide has no server of its own.
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { zipSync } from 'fflate';

import { fromBase64 } from '../backup/zip';

export type ProviderId = 'github' | 'netlify' | 'vercel' | 'cloudflare' | 'render';

export interface SiteFile {
  // Relative to the published folder, with forward slashes.
  path: string;
  base64: string;
}

// Saved in tide.json under "deploy"; no secrets.
export interface DeployConfig {
  provider: ProviderId;
  folder: string;
  // Deploy on its own: after saving (once it goes quiet) or after each commit.
  auto?: 'off' | 'save' | 'commit';
  github?: { owner: string; repo: string; branch: string };
  netlify?: { siteId: string };
  vercel?: { project: string };
  cloudflare?: { accountId: string; project: string };
}

export interface DeployResult {
  url: string;
  // Settings the provider created (a new site's id); merged back into tide.json.
  config?: Partial<DeployConfig>;
}

export type Progress = (message: string) => void;

const json = async (res: Response, service: string) => {
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const detail = data?.errors?.[0]?.message ?? data?.error?.message ?? data?.message ?? data?.error ?? res.statusText;
    throw new Error(`${service}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)} (${res.status})`);
  }
  return data;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain',
  xml: 'application/xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
};
export const contentType = (path: string) => MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

// Runs `fn` over items, a few at a time.
async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

// GitHub Pages: the folder becomes the whole of a branch (gh-pages by default),
// committed through the Git Data API, then Pages is switched on for it.
export async function deployGitHubPages(
  files: SiteFile[],
  target: { owner: string; repo: string; branch: string },
  token: string,
  progress: Progress,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<DeployResult> {
  const base = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const call = async (method: string, path: string, body?: unknown, okStatuses: number[] = []) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (okStatuses.includes(res.status)) return null;
    if (res.status === 409) throw new Error('GitHub: the repository is empty. Push a first commit to it, then deploy.');
    return json(res, 'GitHub');
  };
  const existing = await call('GET', `/git/ref/heads/${encodeURIComponent(target.branch)}`, undefined, [404]);
  // .nojekyll so folders starting with _ (like _next) are served as they are.
  const all = files.some((f) => f.path === '.nojekyll') ? files : [...files, { path: '.nojekyll', base64: '' }];
  const tree: { path: string; mode: string; type: string; sha: string }[] = new Array(all.length);
  let done = 0;
  await pool(all, 4, async (f, i) => {
    const blob = await call('POST', '/git/blobs', { content: f.base64, encoding: 'base64' });
    tree[i] = { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
    progress(`Uploading files (${++done}/${all.length})`);
  });
  progress('Committing');
  const t = await call('POST', '/git/trees', { tree });
  const commit = await call('POST', '/git/commits', { message: 'Deploy from Tide', tree: t.sha, parents: existing ? [existing.object.sha] : [] });
  if (existing) await call('PATCH', `/git/refs/heads/${encodeURIComponent(target.branch)}`, { sha: commit.sha, force: true });
  else await call('POST', '/git/refs', { ref: `refs/heads/${target.branch}`, sha: commit.sha });
  progress('Turning on GitHub Pages');
  let pages = await call('GET', '/pages', undefined, [404]);
  if (!pages) pages = await call('POST', '/pages', { source: { branch: target.branch, path: '/' } });
  else if (pages.source?.branch !== target.branch) await call('PUT', '/pages', { source: { branch: target.branch, path: '/' } });
  return { url: pages.html_url ?? `https://${target.owner}.github.io/${target.repo}/` };
}

// Netlify: a new site the first time, then the folder as one zip upload.
export async function deployNetlify(
  files: SiteFile[],
  siteId: string | undefined,
  token: string,
  progress: Progress,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<DeployResult> {
  const api = 'https://api.netlify.com/api/v1';
  const auth = { Authorization: `Bearer ${token}` };
  let id = siteId;
  if (!id) {
    progress('Creating a Netlify site');
    const site = await json(await fetchImpl(`${api}/sites`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' }), 'Netlify');
    id = site.id as string;
  }
  progress('Uploading');
  const zip = zipSync(Object.fromEntries(files.map((f) => [f.path, fromBase64(f.base64)])));
  let deploy = await json(await fetchImpl(`${api}/sites/${id}/deploys`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip as unknown as BodyInit }), 'Netlify');
  for (let i = 0; i < 60 && !['ready', 'error'].includes(deploy.state); i++) {
    progress(`Netlify is processing (${deploy.state})`);
    await sleep(2000);
    deploy = await json(await fetchImpl(`${api}/deploys/${deploy.id}`, { headers: auth }), 'Netlify');
  }
  if (deploy.state === 'error') throw new Error(`Netlify: ${deploy.error_message ?? 'the deploy failed'}`);
  return { url: deploy.ssl_url ?? deploy.url ?? deploy.deploy_ssl_url, config: { netlify: { siteId: id! } } };
}

// Vercel: the files go inline in one deployment request; no build step runs.
export async function deployVercel(
  files: SiteFile[],
  project: string,
  token: string,
  progress: Progress,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<DeployResult> {
  const auth = { Authorization: `Bearer ${token}` };
  progress('Uploading');
  let d = await json(
    await fetchImpl('https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: project,
        target: 'production',
        files: files.map((f) => ({ file: f.path, data: f.base64, encoding: 'base64' })),
        projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
      }),
    }),
    'Vercel',
  );
  for (let i = 0; i < 60 && !['READY', 'ERROR', 'CANCELED'].includes(d.readyState); i++) {
    progress(`Vercel is processing (${String(d.readyState).toLowerCase()})`);
    await sleep(2000);
    d = await json(await fetchImpl(`https://api.vercel.com/v13/deployments/${d.id}`, { headers: auth }), 'Vercel');
  }
  if (d.readyState !== 'READY') throw new Error(`Vercel: the deployment ended as ${String(d.readyState).toLowerCase()}`);
  const alias = (d.alias as string[] | undefined)?.find((a) => a.endsWith('.vercel.app') && !a.includes('-git-')) ?? d.url;
  return { url: `https://${alias}` };
}

// Cloudflare Pages Direct Upload, the same steps `wrangler pages deploy` takes:
// hash each file, upload the ones Cloudflare doesn't have, then create the
// deployment from a manifest of path → hash.
export const cloudflareHash = (base64: string, path: string) => {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
  return bytesToHex(blake3(new TextEncoder().encode(base64 + ext))).slice(0, 32);
};

export async function deployCloudflare(
  files: SiteFile[],
  target: { accountId: string; project: string },
  token: string,
  progress: Progress,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<DeployResult> {
  const api = 'https://api.cloudflare.com/client/v4';
  const account = `${api}/accounts/${encodeURIComponent(target.accountId)}/pages/projects`;
  const auth = { Authorization: `Bearer ${token}` };
  const call = async (url: string, init: RequestInit = {}, okStatuses: number[] = []) => {
    const res = await fetchImpl(url, init);
    if (okStatuses.includes(res.status)) return null;
    return (await json(res, 'Cloudflare')).result;
  };
  const exists = await call(`${account}/${encodeURIComponent(target.project)}`, { headers: auth }, [404]);
  if (!exists) {
    progress('Creating the Pages project');
    await call(account, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: target.project, production_branch: 'main' }) });
  }
  const { jwt } = await call(`${account}/${encodeURIComponent(target.project)}/upload-token`, { headers: auth });
  const asJwt = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  const hashed = files.map((f) => ({ ...f, hash: cloudflareHash(f.base64, f.path) }));
  const unique = [...new Map(hashed.map((f) => [f.hash, f])).values()];
  const missing: string[] = await call(`${api}/pages/assets/check-missing`, { method: 'POST', headers: asJwt, body: JSON.stringify({ hashes: unique.map((f) => f.hash) }) });
  const toUpload = unique.filter((f) => missing.includes(f.hash));
  for (let i = 0; i < toUpload.length; i += 20) {
    progress(`Uploading files (${Math.min(i + 20, toUpload.length)}/${toUpload.length})`);
    const batch = toUpload.slice(i, i + 20).map((f) => ({ key: f.hash, value: f.base64, metadata: { contentType: contentType(f.path) }, base64: true }));
    await call(`${api}/pages/assets/upload`, { method: 'POST', headers: asJwt, body: JSON.stringify(batch) });
  }
  await call(`${api}/pages/assets/upsert-hashes`, { method: 'POST', headers: asJwt, body: JSON.stringify({ hashes: unique.map((f) => f.hash) }) });
  progress('Creating the deployment');
  const form = new FormData();
  form.append('manifest', JSON.stringify(Object.fromEntries(hashed.map((f) => [`/${f.path}`, f.hash]))));
  await call(`${account}/${encodeURIComponent(target.project)}/deployments`, { method: 'POST', headers: auth, body: form });
  return { url: `https://${target.project}.pages.dev` };
}

// Render builds from the connected Git repository; Tide asks it to deploy now.
export async function deployRender(hookUrl: string, progress: Progress, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<DeployResult> {
  if (!/^https:\/\/api\.render\.com\/deploy\//.test(hookUrl)) throw new Error('Render: that isn’t a deploy hook URL. Copy it from your service’s Settings → Deploy Hook.');
  progress('Asking Render to deploy');
  await json(await fetchImpl(hookUrl, { method: 'POST' }), 'Render');
  return { url: 'https://dashboard.render.com' };
}
