// @ts-check
// Installs pure-Python wheels from PyPI into <project>/.pylibs. Wheels that
// contain compiled code can't load in the embedded interpreter, so packages
// without a "none-any" wheel are refused with a pointer to Remote mode.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const markers = require('./markers');
const pep440 = require('./pep440');
const zip = require('./zip');

const DEFAULT_INDEX = 'https://pypi.org';

/** @returns {Promise<Buffer>} */
function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers: { 'user-agent': 'tide-pip', accept: 'application/json' } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(status === 404 ? 'not found on PyPI' : `HTTP ${status} for ${url}`));
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

/** PEP 503 name normalization. */
const normalize = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** "requests[socks] (>=2.0) ; python_version>'3'" -> { name, extras, spec, marker } */
function parseRequirement(text) {
  const [req, marker = ''] = String(text).split(';');
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*\(?([^)]*)\)?\s*$/.exec(req);
  if (!m) throw new Error(`can't parse requirement "${text}"`);
  return {
    name: m[1],
    extras: (m[2] || '').split(',').map((e) => e.trim()).filter(Boolean),
    spec: m[3].trim(),
    marker: marker.trim(),
  };
}

const isPureWheel = (filename) => /-(py3|py2\.py3|py3\.py2)-none-any\.whl$/.test(filename);

/** Reads the dist-info folders already in `target`: normalized name -> { version, dir }. */
function installed(target) {
  /** @type {Map<string, { version: string, dir: string, name: string }>} */
  const out = new Map();
  if (!fs.existsSync(target)) return out;
  for (const entry of fs.readdirSync(target)) {
    const m = /^(.+)-([^-]+)\.dist-info$/.exec(entry);
    if (m) out.set(normalize(m[1]), { name: m[1], version: m[2], dir: entry });
  }
  return out;
}

/** Deletes the files an installed distribution lists in its RECORD. */
function removeDist(target, dir) {
  const root = path.resolve(target);
  const record = path.join(target, dir, 'RECORD');
  /** @type {Set<string>} */
  const parents = new Set();
  if (fs.existsSync(record)) {
    for (const line of fs.readFileSync(record, 'utf8').split('\n')) {
      const file = line.split(',')[0];
      if (!file) continue;
      const abs = path.resolve(target, file);
      if (!abs.startsWith(root + path.sep)) continue;
      fs.rmSync(abs, { force: true });
      parents.add(path.dirname(abs));
    }
  }
  fs.rmSync(path.join(target, dir), { recursive: true, force: true });
  // Like pip, drop folders the package leaves empty (deepest first).
  for (const start of [...parents].sort((a, b) => b.length - a.length)) {
    for (let d = start; d.startsWith(root + path.sep); d = path.dirname(d)) {
      try {
        if (fs.readdirSync(d).length) break;
        fs.rmdirSync(d);
      } catch {
        break;
      }
    }
  }
}

/** Writes a wheel's files into `target`; .data/purelib and platlib land at the top level. */
function unpack(wheel, target) {
  for (const { name, data } of zip.entries(wheel)) {
    let rel = name;
    const dataDir = /^[^/]+\.data\/(purelib|platlib|scripts|headers|data)\/(.*)$/.exec(name);
    if (dataDir) {
      if (dataDir[1] !== 'purelib' && dataDir[1] !== 'platlib') continue;
      rel = dataDir[2];
    }
    const abs = path.resolve(target, rel);
    if (!abs.startsWith(path.resolve(target) + path.sep)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
}

/**
 * @param {{ projectDir: string, requirements: string[], index?: string, platform?: string, log?: (l: string) => void }} options
 */
async function install({ projectDir, requirements, index = DEFAULT_INDEX, platform, log = console.log }) {
  const started = Date.now();
  const target = path.join(projectDir, '.pylibs');
  fs.mkdirSync(target, { recursive: true });
  const env = markers.deviceEnv(platform);
  const base = index.replace(/\/$/, '');

  /** @type {Map<string, Promise<any>>} */
  const docs = new Map();
  const project = (name) => {
    const key = normalize(name);
    if (!docs.has(key)) {
      docs.set(
        key,
        get(`${base}/pypi/${key}/json`).then(
          (b) => JSON.parse(b.toString('utf8')),
          (e) => {
            throw new Error(`${name}: ${e.message}`);
          },
        ),
      );
    }
    return docs.get(key);
  };

  /** @type {Map<string, { name: string, version: string, file: any, requires: string[] }>} */
  const chosen = new Map();
  const warnings = [];
  /** @type {{ req: ReturnType<typeof parseRequirement>, from: string }[]} */
  let queue = requirements.map((r) => ({ req: parseRequirement(r), from: 'command line' }));

  while (queue.length) {
    const next = [];
    for (const { req, from } of queue) {
      const key = normalize(req.name);
      const existing = chosen.get(key);
      if (existing) {
        if (req.spec && !pep440.satisfies(existing.version, req.spec)) {
          warnings.push(`${from} wants ${req.name}${req.spec}, but ${existing.name} ${existing.version} was already picked`);
        }
        continue;
      }
      const doc = await project(req.name);
      const versions = Object.keys(doc.releases || {}).filter((v) => (doc.releases[v] || []).some((f) => !f.yanked));
      const pure = versions.filter((v) => doc.releases[v].some((f) => !f.yanked && isPureWheel(f.filename)));
      const version = pep440.best(pure, req.spec);
      if (!version) {
        const any = pep440.best(versions, req.spec);
        throw new Error(
          any
            ? `${req.name} ${any} has no pure-Python wheel, so it needs a native build; install it in Remote mode`
            : `no version of ${req.name} matches "${req.spec}"`,
        );
      }
      const file = doc.releases[version].find((f) => !f.yanked && isPureWheel(f.filename));
      // requires_dist is per version; the top-level document only has the latest.
      const meta = version === doc.info.version ? doc : await get(`${base}/pypi/${normalize(req.name)}/${version}/json`).then((b) => JSON.parse(b.toString('utf8')));
      const requires = meta.info.requires_dist || [];
      chosen.set(key, { name: doc.info.name || req.name, version, file, requires });
      for (const r of requires) {
        const dep = parseRequirement(r);
        const marker = dep.marker;
        const wanted = !marker || req.extras.some((extra) => markers.evaluate(marker, { ...env, extra })) || markers.evaluate(marker, env);
        if (wanted) next.push({ req: dep, from: `${doc.info.name || req.name} ${version}` });
      }
    }
    queue = next;
  }

  const have = installed(target);
  let added = 0;
  for (const [key, pkg] of chosen) {
    const current = have.get(key);
    if (current && current.version === pkg.version) continue;
    const wheel = await get(pkg.file.url);
    const sha = pkg.file.digests && pkg.file.digests.sha256;
    if (sha && crypto.createHash('sha256').update(wheel).digest('hex') !== sha) {
      throw new Error(`${pkg.name} ${pkg.version}: checksum mismatch`);
    }
    if (current) removeDist(target, current.dir);
    unpack(wheel, target);
    added++;
    log(`Installed ${pkg.name} ${pkg.version}`);
  }
  for (const w of warnings) log(`warning: ${w}`);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(added ? `Added ${added} package${added === 1 ? '' : 's'} to .pylibs in ${seconds}s` : `Requirements already satisfied (${seconds}s)`);
  return { added, chosen };
}

function uninstall({ projectDir, names, log = console.log }) {
  const target = path.join(projectDir, '.pylibs');
  const have = installed(target);
  for (const name of names) {
    const dist = have.get(normalize(name));
    if (!dist) {
      log(`warning: ${name} is not installed`);
      continue;
    }
    removeDist(target, dist.dir);
    log(`Removed ${dist.name} ${dist.version}`);
  }
}

function list({ projectDir }) {
  return [...installed(path.join(projectDir, '.pylibs')).values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { install, uninstall, list, parseRequirement, normalize };
