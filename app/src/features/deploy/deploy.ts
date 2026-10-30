import * as SecureStore from 'expo-secure-store';

import { workspace } from '../../state';
import { RUN_CONFIG_FILE } from '../files/templates';
import { runTool } from '../../runtime/tool';
import {
  DeployConfig,
  DeployResult,
  deployCloudflare,
  deployFirebase,
  deployGitHubPages,
  deployNetlify,
  deployRender,
  deployVercel,
  googleAccessToken,
  parseServiceAccount,
  Progress,
  ProviderId,
  SiteFile,
} from './providers';
import { gitSettingsStore } from '../git/settings';

export const PROVIDERS: { id: ProviderId; label: string; token: string | null; help: string }[] = [
  { id: 'github', label: 'GitHub Pages', token: null, help: 'Uses your GitHub sign-in. The folder is published to a gh-pages branch of the repository.' },
  { id: 'netlify', label: 'Netlify', token: 'Personal access token', help: 'Create a token at app.netlify.com → User settings → Applications.' },
  { id: 'vercel', label: 'Vercel', token: 'Access token', help: 'Create a token at vercel.com/account/settings/tokens.' },
  { id: 'cloudflare', label: 'Cloudflare Pages', token: 'API token', help: 'Create a token with "Cloudflare Pages: Edit" at dash.cloudflare.com → My Profile → API Tokens.' },
  {
    id: 'firebase',
    label: 'Firebase Hosting',
    token: 'Service account key (JSON)',
    help: 'In the Firebase console: Project settings → Service accounts → Generate new private key, then paste the whole file. Give the account the Firebase Hosting Admin role.',
  },
  { id: 'render', label: 'Render', token: null, help: 'Render builds from your Git repository. Push your changes, then Deploy triggers a build with your service’s Deploy Hook.' },
];

// Above this the upload is too big to send from the phone in one go.
export const MAX_SITE_BYTES = 50 * 1024 * 1024;
const SKIP = /(^|\/)(\.git|node_modules|\.DS_Store|\.tide|\.pylibs|__pycache__)(\/|$)/;

const tokenKey = (provider: ProviderId) => `tide.deploy.${provider}`;
const hookKey = (project: string) => `tide.deploy.render.${project.replace(/[^\w.-]/g, '_')}`;

export async function getToken(provider: ProviderId, project: string): Promise<string> {
  if (provider === 'github') return gitSettingsStore.getState().settings.token;
  return (await SecureStore.getItemAsync(provider === 'render' ? hookKey(project) : tokenKey(provider))) ?? '';
}

export async function setToken(provider: ProviderId, project: string, value: string): Promise<void> {
  const key = provider === 'render' ? hookKey(project) : tokenKey(provider);
  if (value.trim()) await SecureStore.setItemAsync(key, value.trim());
  else await SecureStore.deleteItemAsync(key);
}

// The folder to publish, guessed from what's there: build output first.
export async function guessFolder(project: string): Promise<string> {
  for (const dir of ['dist', 'build', 'out', 'public', '_site', 'site', 'docs']) {
    if ((await workspace.stat(project, dir)) === 'dir' && (await workspace.stat(project, `${dir}/index.html`)) === 'file') return dir;
  }
  return '';
}

export async function readConfig(project: string): Promise<DeployConfig | null> {
  // Also read by automatic deploys on every save; it's one small file.
  try {
    return (JSON.parse(await workspace.readFile(project, RUN_CONFIG_FILE)).deploy as DeployConfig) ?? null;
  } catch {
    return null;
  }
}

// Saves the deploy settings into tide.json, keeping everything else in it.
export async function saveConfig(project: string, config: DeployConfig): Promise<void> {
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(await workspace.readFile(project, RUN_CONFIG_FILE));
  } catch {
    // No tide.json yet, or not valid JSON: start one with just the deploy settings.
  }
  json.deploy = config;
  const text = `${JSON.stringify(json, null, 2)}\n`;
  if ((await workspace.stat(project, RUN_CONFIG_FILE)) === 'file') await workspace.writeFile(project, RUN_CONFIG_FILE, text);
  else await workspace.createFile(project, '', RUN_CONFIG_FILE, text);
}

export async function collectSite(project: string, folder: string, progress: Progress): Promise<SiteFile[]> {
  const prefix = folder.replace(/^\/+|\/+$/g, '');
  const paths = (await workspace.listFiles(project)).filter((p) => (!prefix || p === prefix || p.startsWith(`${prefix}/`)) && !SKIP.test(p));
  if (!paths.some((p) => p === (prefix ? `${prefix}/index.html` : 'index.html')))
    throw new Error(`There's no index.html in ${prefix || 'the project'}. Pick the folder your site is built into.`);
  let bytes = 0;
  const files: SiteFile[] = [];
  for (const [i, p] of paths.entries()) {
    progress(`Reading files (${i + 1}/${paths.length})`);
    const base64 = await workspace.readBase64(project, p);
    bytes += (base64.length * 3) / 4;
    if (bytes > MAX_SITE_BYTES) throw new Error('The site is over 50 MB; deploy it from a computer or connect the repository to your host instead.');
    files.push({ path: prefix ? p.slice(prefix.length + 1) : p, base64 });
  }
  return files;
}

export async function deploy(project: string, config: DeployConfig, progress: Progress): Promise<DeployResult> {
  const token = await getToken(config.provider, project);
  if (!token) throw new Error(config.provider === 'github' ? 'Sign in to GitHub first (Settings → GitHub).' : config.provider === 'render' ? 'Add your Deploy Hook URL first.' : `Add your ${PROVIDERS.find((p) => p.id === config.provider)!.label} token first.`);
  if (config.provider === 'render') return deployRender(token, progress);
  const files = await collectSite(project, config.folder, progress);
  switch (config.provider) {
    case 'github':
      if (!config.github?.owner || !config.github.repo) throw new Error('Choose the GitHub repository to publish to.');
      return deployGitHubPages(files, { ...config.github, branch: config.github.branch || 'gh-pages' }, token, progress);
    case 'netlify':
      return deployNetlify(files, config.netlify?.siteId || undefined, token, progress);
    case 'vercel':
      return deployVercel(files, config.vercel?.project || project.toLowerCase().replace(/[^a-z0-9-]/g, '-'), token, progress);
    case 'cloudflare':
      if (!config.cloudflare?.accountId || !config.cloudflare.project) throw new Error('Enter your Cloudflare account ID and a project name.');
      return deployCloudflare(files, config.cloudflare, token, progress);
    case 'firebase': {
      const key = parseServiceAccount(token);
      const site = config.firebase?.site || key.project_id;
      if (!site) throw new Error('Enter the Firebase Hosting site (usually the project ID).');
      progress('Signing in to Google');
      // RSA signing happens in the Node runtime; the app's JavaScript engine has no RSA.
      // Loaded here so screens that only show deploy status don't start it.
      const { localRunner } = require('../../runtime') as typeof import('../../runtime');
      const jwt = await runTool(localRunner, 'google-jwt', [], {
        TIDE_GOOGLE: JSON.stringify({ client_email: key.client_email, private_key: key.private_key, scope: 'https://www.googleapis.com/auth/firebase.hosting' }),
      });
      const result = await deployFirebase(files, site, await googleAccessToken(jwt), progress);
      return { ...result, config: { firebase: { site } } };
    }
  }
}
