// `npm run` in the Local terminal: package.json scripts made of commands Tide
// can run, joined with && or ;. Leading VAR=value assignments set the
// environment. Binaries from node_modules are found through their package's
// "bin" field (Tide's npm doesn't create node_modules/.bin) and run with node.
import type { DirEntry, EntryKind } from '../../files/fs';
import { joinPath } from '../../files/fs';

export interface ScriptStep {
  line: string;
  // Run only if the previous step succeeded (&&); otherwise always (;).
  ifOk: boolean;
}

export class ScriptError extends Error {}

// Splits a script on unquoted && and ;. Pipes, || and command substitution
// need a real shell, so they're refused with a pointer to Remote mode.
export function splitScript(script: string): ScriptStep[] {
  const steps: ScriptStep[] = [];
  let current = '';
  let quote: string | null = null;
  let ifOk = true;
  const push = (nextIfOk: boolean) => {
    if (current.trim()) steps.push({ line: current.trim(), ifOk });
    current = '';
    ifOk = nextIfOk;
  };
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') current += script[++i] ?? '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === '\\') {
      current += c + (script[++i] ?? '');
    } else if (c === '&' && script[i + 1] === '&') {
      push(true);
      i++;
    } else if (c === ';') {
      push(false);
    } else if (c === '|' || c === '`' || (c === '$' && script[i + 1] === '(') || (c === '&' && script[i + 1] !== '&')) {
      throw new ScriptError(`"${script}" needs a full shell (${c === '|' ? 'pipes and ||' : c === '&' ? 'background jobs' : 'command substitution'}); run it in the Remote terminal`);
    } else {
      current += c;
    }
  }
  push(true);
  return steps;
}

// FOO=1 BAR=x node app.js → env {FOO: '1', BAR: 'x'} and the rest.
export function takeEnv(words: string[]): { env: Record<string, string>; rest: string[] } {
  const env: Record<string, string> = {};
  let i = 0;
  for (; i < words.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(words[i]);
    if (!m) break;
    env[m[1]] = m[2];
  }
  return { env, rest: words.slice(i) };
}

export interface ScriptFs {
  stat(path: string): Promise<EntryKind | null>;
  list(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<string>;
}

// The package.json that applies at `cwd`: the nearest one up to the project root.
export async function findPackage(fs: ScriptFs, cwd: string): Promise<{ dir: string; json: { scripts?: Record<string, unknown>; bin?: unknown } } | null> {
  const parts = cwd ? cwd.split('/') : [];
  for (let n = parts.length; n >= 0; n--) {
    const dir = parts.slice(0, n).join('/');
    const path = joinPath(dir, 'package.json');
    if ((await fs.stat(path)) === 'file') {
      try {
        return { dir, json: JSON.parse(await fs.readFile(path)) };
      } catch {
        throw new ScriptError(`${path || 'package.json'} isn't valid JSON`);
      }
    }
  }
  return null;
}

export const scriptsOf = (json: { scripts?: Record<string, unknown> }) =>
  Object.fromEntries(Object.entries(json.scripts ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));

const binsOf = (pkgName: string, bin: unknown): Record<string, string> => {
  if (typeof bin === 'string') return { [pkgName.split('/').pop()!]: bin };
  if (bin && typeof bin === 'object') return Object.fromEntries(Object.entries(bin).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return {};
};

// The JS file behind a command such as "tsc" or "jest", from node_modules in
// `dir` (the package's folder). Checks the package with the same name first.
export async function resolveBin(fs: ScriptFs, dir: string, name: string): Promise<string | null> {
  const modules = joinPath(dir, 'node_modules');
  if ((await fs.stat(modules)) !== 'dir') return null;
  const tryPackage = async (pkgDir: string): Promise<string | null> => {
    const manifest = joinPath(pkgDir, 'package.json');
    if ((await fs.stat(manifest)) !== 'file') return null;
    try {
      const json = JSON.parse(await fs.readFile(manifest));
      const target = binsOf(json.name ?? '', json.bin)[name];
      return target ? joinPath(pkgDir, target.replace(/^\.\//, '')) : null;
    } catch {
      return null;
    }
  };
  const direct = await tryPackage(joinPath(modules, name));
  if (direct) return direct;
  for (const e of await fs.list(modules)) {
    if (e.kind !== 'dir' || e.name.startsWith('.')) continue;
    if (e.name.startsWith('@')) {
      for (const s of await fs.list(joinPath(modules, e.name))) {
        if (s.kind === 'dir') {
          const found = await tryPackage(joinPath(modules, e.name, s.name));
          if (found) return found;
        }
      }
    } else {
      const found = await tryPackage(joinPath(modules, e.name));
      if (found) return found;
    }
  }
  return null;
}

// npm's lifecycle: prefoo, foo, postfoo; extra arguments go to foo itself.
export function lifecycle(scripts: Record<string, string>, name: string, extra: string[]): { name: string; script: string }[] {
  const quoteArg = (a: string) => (/^[\w./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const main = scripts[name];
  if (main === undefined) return [];
  return [
    ...(scripts[`pre${name}`] !== undefined ? [{ name: `pre${name}`, script: scripts[`pre${name}`] }] : []),
    { name, script: extra.length ? `${main} ${extra.map(quoteArg).join(' ')}` : main },
    ...(scripts[`post${name}`] !== undefined ? [{ name: `post${name}`, script: scripts[`post${name}`] }] : []),
  ];
}
