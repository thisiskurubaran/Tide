// The package manager: what a project has installed, what the registries
// offer, and the commands that change it.
import type { Workspace } from '../files/workspace';

export type Ecosystem = 'npm' | 'pip';

export interface Installed {
  name: string;
  // Installed version; null when listed (package.json, requirements.txt) but missing.
  version: string | null;
  // What package.json or requirements.txt asks for, if anything.
  wanted: string | null;
  dev: boolean;
}

export interface Found {
  name: string;
  version: string;
  description: string;
}

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const readJson = async (workspace: Workspace, project: string, path: string) => {
  try {
    return JSON.parse(await workspace.readFile(project, path)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export async function detectEcosystems(workspace: Workspace, project: string): Promise<Ecosystem[]> {
  const files = (await workspace.list(project, '').catch(() => [])).map((e) => e.name);
  const out: Ecosystem[] = [];
  if (files.includes('package.json') || files.includes('node_modules') || files.some((f) => /\.(m?js|ts|tsx|jsx)$/.test(f))) out.push('npm');
  if (files.includes('requirements.txt') || files.includes('.pylibs') || files.some((f) => f.endsWith('.py'))) out.push('pip');
  return out.length ? out : ['npm', 'pip'];
}

export async function npmInstalled(workspace: Workspace, project: string): Promise<Installed[]> {
  const pkg = (await readJson(workspace, project, 'package.json')) ?? {};
  const out: Installed[] = [];
  for (const [field, dev] of [['dependencies', false], ['devDependencies', true]] as const) {
    const deps = (pkg[field] ?? {}) as Record<string, string>;
    for (const [name, wanted] of Object.entries(deps)) {
      const meta = await readJson(workspace, project, `node_modules/${name}/package.json`);
      out.push({ name, wanted: String(wanted), version: typeof meta?.version === 'string' ? meta.version : null, dev });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// PEP 503: case, "-", "_" and "." don't matter.
export const normalizePip = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

export async function pipInstalled(workspace: Workspace, project: string): Promise<Installed[]> {
  const entries = await workspace.list(project, '.pylibs').catch(() => []);
  const byName = new Map<string, Installed>();
  for (const e of entries) {
    const m = /^(.+?)-([^-]+)\.dist-info$/.exec(e.name);
    if (e.kind === 'dir' && m) byName.set(normalizePip(m[1]), { name: m[1].replace(/_/g, '-'), version: m[2], wanted: null, dev: false });
  }
  const requirements = await workspace.readFile(project, 'requirements.txt').catch(() => '');
  for (const line of requirements.split('\n')) {
    const req = line.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(req);
    if (!m || req.startsWith('-')) continue;
    const key = normalizePip(m[1]);
    const have = byName.get(key);
    byName.set(key, { name: have?.name ?? m[1], version: have?.version ?? null, wanted: m[3].replace(/;.*/, '').trim() || '*', dev: false });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchNpm(query: string, fetch: Fetch): Promise<Found[]> {
  const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`);
  if (!res.ok) throw new Error(`The npm registry answered ${res.status}`);
  const body = (await res.json()) as { objects?: { package: { name: string; version: string; description?: string } }[] };
  return (body.objects ?? []).map(({ package: p }) => ({ name: p.name, version: p.version, description: p.description ?? '' }));
}

// PyPI has no search API, so this looks the name up exactly.
export async function searchPip(query: string, fetch: Fetch): Promise<Found[]> {
  const name = query.trim().split(/\s+/)[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return [];
  const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(normalizePip(name))}/json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`PyPI answered ${res.status}`);
  const body = (await res.json()) as { info: { name: string; version: string; summary?: string } };
  return [{ name: body.info.name, version: body.info.version, description: body.info.summary ?? '' }];
}

export async function latestVersion(ecosystem: Ecosystem, name: string, fetch: Fetch): Promise<string | null> {
  const url = ecosystem === 'npm' ? `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest` : `https://pypi.org/pypi/${encodeURIComponent(normalizePip(name))}/json`;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as { version?: string; info?: { version?: string } };
  return (ecosystem === 'npm' ? body.version : body.info?.version) ?? null;
}

// 1.10.0 > 1.9.3; pre-releases ("2.0.0-beta.1", "2.0.0b1") count as older than the release.
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+(?:\.\d+)*)(.*)$/.exec(v.trim());
    return m ? { nums: m[1].split('.').map(Number), pre: m[2] !== '' && !m[2].startsWith('+') } : null;
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d > 0;
  }
  return b.pre && !a.pre;
}

export type Action = { kind: 'install'; name: string; version?: string } | { kind: 'update'; name: string } | { kind: 'remove'; name: string };

// The command line for an action; the local shell's npm and pip take the same.
export function commandArgs(ecosystem: Ecosystem, action: Action): string[] {
  if (action.kind === 'remove') return ['uninstall', action.name];
  if (ecosystem === 'npm') return ['install', action.kind === 'update' ? `${action.name}@latest` : action.version ? `${action.name}@${action.version}` : action.name];
  // pip install without a version takes the newest, replacing what is there.
  return ['install', action.kind === 'install' && action.version ? `${action.name}==${action.version}` : action.name];
}

// Spelled out for the remote terminal, where pip installs into the container.
export const commandLine = (ecosystem: Ecosystem, action: Action) =>
  [ecosystem === 'npm' ? 'npm' : 'pip', ...commandArgs(ecosystem, action)].map((a) => (/^[\w@./=^~<>-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
