// @ts-check
// Installs pure-JS packages from the npm registry into node_modules. No
// lifecycle scripts run and native addons can't be built, so packages that
// need either print a warning and should be installed in Remote mode instead.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const semver = require('./semver');
const { extract } = require('./tar');

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CONCURRENCY = 8;

/** @returns {Promise<Buffer>} */
function get(url, accept, redirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers: { accept, 'user-agent': 'tide-npm' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), accept, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(status === 404 ? 'not found in the registry' : `HTTP ${status} for ${url}`));
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`timed out fetching ${url}`)));
  });
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** "express", "express@5", "@scope/pkg@^1.2" -> [name, range] */
function parseSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at > 0) return [spec.slice(0, at), spec.slice(at + 1) || 'latest'];
  return [spec, 'latest'];
}

/**
 * @param {{ cwd: string, add?: string[], registry?: string, log?: (line: string) => void }} options
 */
async function install({ cwd, add = [], registry = DEFAULT_REGISTRY, log = console.log }) {
  const started = Date.now();
  const pkgFile = path.join(cwd, 'package.json');
  const pkg = readJson(pkgFile) || { name: path.basename(cwd), version: '1.0.0', private: true };
  pkg.dependencies = pkg.dependencies || {};

  /** @type {Map<string, Promise<any>>} */
  const packuments = new Map();
  const packument = (name) => {
    if (!packuments.has(name)) {
      const url = `${registry.replace(/\/$/, '')}/${name.replace('/', '%2F')}`;
      packuments.set(
        name,
        get(url, 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8').then(
          (b) => JSON.parse(b.toString('utf8')),
          (e) => {
            throw new Error(`${name}: ${e.message}`);
          },
        ),
      );
    }
    return packuments.get(name);
  };

  /** Picks the version for a range, honouring dist-tags like "latest". */
  async function resolveVersion(name, range) {
    const doc = await packument(name);
    const tags = doc['dist-tags'] || {};
    if (tags[range]) return { version: tags[range], meta: doc.versions[tags[range]] };
    if (!semver.validRange(range)) throw new Error(`${name}@${range}: only registry versions are supported locally`);
    const versions = Object.keys(doc.versions || {});
    // Prefer the "latest" tag when it satisfies the range, like npm does.
    const latest = tags.latest;
    const version = latest && semver.satisfies(latest, range) ? latest : semver.maxSatisfying(versions, range);
    if (!version) throw new Error(`no version of ${name} matches ${range}`);
    return { version, meta: doc.versions[version] };
  }

  for (const spec of add) {
    const [name, range] = parseSpec(spec);
    const { version } = await resolveVersion(name, range);
    // Same as npm's default save-prefix: whatever was asked for, save ^<installed>.
    pkg.dependencies[name] = `^${version}`;
  }

  // Plan the tree. Each entry is a node_modules location: "node_modules/a" or
  // "node_modules/a/node_modules/b". Dependencies are hoisted to the top level
  // unless a different version already sits there.
  /** @type {Map<string, { name: string, version: string, meta: any }>} */
  const plan = new Map();
  /** @type {{ name: string, range: string, from: string }[]} */
  let level = Object.entries(pkg.dependencies).map(([name, range]) => ({ name, range: String(range), from: '' }));

  while (level.length) {
    /** @type {typeof level} */
    const next = [];
    // Resolve the whole level in parallel, then place packages in order so
    // the result doesn't depend on network timing.
    const resolved = await Promise.all(level.map((d) => resolveVersion(d.name, d.range).then((r) => ({ ...d, ...r }))));
    for (const dep of resolved) {
      // Walk up like require() does: from/node_modules, then each parent.
      let dir = dep.from;
      let placed = false;
      for (;;) {
        const slot = path.posix.join(dir, 'node_modules', dep.name);
        const existing = plan.get(slot);
        if (existing) {
          if (semver.satisfies(existing.version, dep.range)) placed = true;
          break;
        }
        if (!dir) break;
        const parent = dir.lastIndexOf('/node_modules/');
        dir = parent === -1 ? '' : dir.slice(0, parent);
      }
      if (placed) continue;
      const top = path.posix.join('node_modules', dep.name);
      const slot = plan.has(top) ? path.posix.join(dep.from, 'node_modules', dep.name) : top;
      plan.set(slot, { name: dep.name, version: dep.version, meta: dep.meta });
      for (const [name, range] of Object.entries(dep.meta.dependencies || {})) {
        next.push({ name, range: String(range), from: slot });
      }
    }
    level = next;
  }

  const warnings = [];
  let added = 0;
  await pool([...plan.entries()], CONCURRENCY, async ([slot, { name, version, meta }]) => {
    const dest = path.join(cwd, slot);
    const current = readJson(path.join(dest, 'package.json'));
    if (current && current.version === version) return;
    const tarball = await get(meta.dist.tarball, 'application/octet-stream');
    const integrity = meta.dist.integrity;
    if (integrity && integrity.startsWith('sha512-')) {
      const digest = crypto.createHash('sha512').update(tarball).digest('base64');
      if (`sha512-${digest}` !== integrity) throw new Error(`${name}@${version}: integrity check failed`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    const files = extract(zlib.gunzipSync(tarball), dest);
    added++;
    if (meta.hasInstallScript) warnings.push(`${name}@${version} has install scripts, which don't run locally`);
    if (meta.gypfile || files.includes('binding.gyp')) warnings.push(`${name}@${version} needs a native build; use Remote mode`);
  });

  fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  for (const w of warnings.sort()) log(`warn: ${w}`);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(added ? `added ${added} package${added === 1 ? '' : 's'} in ${seconds}s` : `up to date in ${seconds}s`);
  return { plan, added, warnings };
}

module.exports = { install, parseSpec };
