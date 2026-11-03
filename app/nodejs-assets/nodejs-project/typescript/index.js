// @ts-check
// Runs TypeScript without a build step: types are stripped with Sucrase (pure
// JS, bundled into sucrase.js by scripts/build-services.js), never checked.
//
// nodejs-mobile is Node 18, whose ESM loader hooks don't work inside the
// worker threads runs use, so the two module systems are handled differently:
//   CommonJS (no "type": "module", or .cts): a require hook compiles each .ts
//     file in place as it loads, so paths, __dirname and stack traces are the
//     real ones.
//   ESM ("type": "module", or .mts): the static import graph is compiled up
//     front into <base>/.tide/build/<path>.ts.mjs, with relative imports
//     rewritten to the compiled files (or back to the originals for .js/.json),
//     and the entry runs from there. import.meta.url is set to the original
//     file, and stack traces are mapped back to the .ts path.
// Sucrase keeps line numbers, so file:line in errors points at the source.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const TS_EXT = /\.(ts|tsx|mts|cts)$/i;
const BUILD_DIR = path.join('.tide', 'build');

/** @type {((code: string, options: object) => { code: string }) | null} */
let sucraseTransform = null;
function sucrase() {
  if (!sucraseTransform) {
    let mod;
    try {
      mod = require('./sucrase');
    } catch {
      // Tests on the host, and builds that skipped build-services, use the package.
      mod = require('sucrase');
    }
    sucraseTransform = mod.transform;
  }
  return /** @type {NonNullable<typeof sucraseTransform>} */ (sucraseTransform);
}

/** @param {string} file */
const isTs = (file) => TS_EXT.test(file) && !/\.d\.[cm]?tsx?$/i.test(file);

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** @param {string} file @returns {any} */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The nearest package.json at or above `dir`, like Node's package scope. */
function packageScope(/** @type {string} */ dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    const file = path.join(d, 'package.json');
    if (isFile(file)) return { dir: d, json: readJson(file) || {} };
    if (path.dirname(d) === d) return null;
  }
}

/**
 * How Node would treat this file if it were JavaScript: .mts is ESM, .cts is
 * CommonJS, and .ts/.tsx follow "type" in the nearest package.json.
 * @param {string} file @returns {'esm' | 'cjs'}
 */
function formatOf(file) {
  if (/\.mts$/i.test(file)) return 'esm';
  if (/\.cts$/i.test(file)) return 'cjs';
  const scope = packageScope(path.dirname(file));
  return scope && scope.json.type === 'module' ? 'esm' : 'cjs';
}

/** tsconfig's "jsx": "react-jsx" means the automatic runtime. Comments are allowed there. */
function jsxOptions(/** @type {string} */ file) {
  for (let d = path.dirname(file); ; d = path.dirname(d)) {
    const config = path.join(d, 'tsconfig.json');
    if (isFile(config)) {
      let options = {};
      try {
        const text = fs.readFileSync(config, 'utf8').replace(/\/\*[\s\S]*?\*\/|("(?:\\.|[^"\\])*")|\/\/.*$/gm, (m, str) => str || '');
        options = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')).compilerOptions || {};
      } catch {
        // A tsconfig we can't read just means the defaults.
      }
      const o = /** @type {any} */ (options);
      if (o.jsx === 'react-jsx' || o.jsx === 'react-jsxdev') return { jsxRuntime: 'automatic', jsxImportSource: o.jsxImportSource || 'react' };
      return { jsxPragma: o.jsxFactory, jsxFragmentPragma: o.jsxFragmentFactory };
    }
    if (path.dirname(d) === d) return {};
  }
}

/**
 * Strips the types from one file. CommonJS output also turns import/export
 * into require/exports; ESM output keeps them.
 * @param {string} code @param {string} filePath @param {'esm' | 'cjs'} format
 */
function compile(code, filePath, format) {
  const jsx = /\.tsx$/i.test(filePath);
  /** @type {string[]} */
  const transforms = ['typescript'];
  if (jsx) transforms.push('jsx');
  if (format === 'cjs') transforms.push('imports');
  return sucrase()(code, {
    transforms,
    filePath,
    // Node 18 has optional chaining, class fields and the rest; leave them as written.
    disableESTransforms: true,
    injectCreateRequireForImportRequire: format === 'esm',
    ...(jsx ? jsxOptions(filePath) : {}),
  }).code;
}

const JS_TO_TS = /** @type {Record<string, string[]>} */ ({
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
});
const SEARCH = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'];

/**
 * Resolves a relative import the way TypeScript does: "./util.js" may mean
 * util.ts, and "./util" may mean util.ts or util/index.ts.
 * @param {string} dir @param {string} spec @returns {string | null}
 */
function resolveRelative(dir, spec) {
  const target = path.resolve(dir, spec.split(/[?#]/)[0]);
  const ext = path.extname(target).toLowerCase();
  for (const alt of JS_TO_TS[ext] || []) {
    const ts = target.slice(0, -ext.length) + alt;
    if (isFile(ts)) return ts;
  }
  if (isFile(target)) return target;
  for (const e of SEARCH) if (isFile(target + e)) return target + e;
  for (const e of SEARCH) if (isFile(path.join(target, `index${e}`))) return path.join(target, `index${e}`);
  return null;
}

// --- CommonJS ---------------------------------------------------------------

let hooked = false;
/** Compiles .ts files as require() loads them, and lets "./util.js" find util.ts. */
function installRequireHook() {
  if (hooked) return;
  hooked = true;
  const Module = /** @type {any} */ (require('module'));
  for (const ext of ['.ts', '.tsx', '.cts', '.mts']) {
    Module._extensions[ext] = (/** @type {any} */ module, /** @type {string} */ filename) => {
      module._compile(compile(fs.readFileSync(filename, 'utf8'), filename, 'cjs'), filename);
    };
  }
  const resolveFilename = Module._resolveFilename;
  /** @param {string} request @param {any} parent @param {any[]} rest */
  Module._resolveFilename = function (request, parent, ...rest) {
    try {
      return resolveFilename.call(this, request, parent, ...rest);
    } catch (e) {
      const from = parent && parent.filename;
      if (/** @type {any} */ (e).code !== 'MODULE_NOT_FOUND' || !from || !isTs(from) || !/^\.\.?(\/|$)/.test(request)) throw e;
      const found = resolveRelative(path.dirname(from), request);
      if (!found) throw e;
      return found;
    }
  };
}

// --- ESM ----------------------------------------------------------------------

/** Where the compiled copies go: the project (or package) the entry is in. */
function buildBase(/** @type {string} */ entry) {
  const project = process.env.TIDE_PROJECT_DIR;
  if (project && entry.startsWith(project + path.sep)) return project;
  const scope = packageScope(path.dirname(entry));
  return scope ? scope.dir : path.dirname(entry);
}

/** a/b.ts -> <base>/.tide/build/a/b.ts.mjs; files above the base go under _up/. */
function outPath(/** @type {string} */ base, /** @type {string} */ file) {
  const rel = path.relative(base, file).split(path.sep).map((s) => (s === '..' ? '_up' : s)).join(path.sep);
  return path.join(base, BUILD_DIR, rel + (/\.cts$/i.test(file) ? '.cjs' : '.mjs'));
}

/** @param {string} from @param {string} to */
function relativeSpec(from, to) {
  const rel = path.relative(path.dirname(from), to).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

// from '…', import '…', import('…'), export … from '…'. Only relative ones are touched.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"\n]*|\.\.?)\2/g;

/** @param {string} file @param {string} content */
function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return;
  } catch {
    // Not there yet.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Compiles `entry` and every TypeScript file it statically imports into the
 * build directory. Returns the compiled entry to run.
 * @param {string} entry
 */
function buildEsm(entry) {
  const base = buildBase(entry);
  const buildRoot = path.join(base, BUILD_DIR);
  // The compiled files are a cache; keep them out of git.
  writeIfChanged(path.join(buildRoot, '.gitignore'), '*\n');
  /** @type {Map<string, string>} */
  const done = new Map();
  const visit = (/** @type {string} */ src) => {
    const known = done.get(src);
    if (known) return known;
    const out = outPath(base, src);
    done.set(src, out);
    if (/\.cts$/i.test(src)) {
      // CommonJS inside an ESM graph: the require hook compiles it where it is.
      writeIfChanged(out, `module.exports = require(${JSON.stringify(src)});\n`);
      return out;
    }
    let code = compile(fs.readFileSync(src, 'utf8'), src, 'esm');
    code = code.replace(SPECIFIER, (match, before, quote, spec) => {
      const target = resolveRelative(path.dirname(src), spec);
      const to = target ? (isTs(target) ? visit(target) : target) : path.resolve(path.dirname(src), spec);
      return `${before}${quote}${relativeSpec(out, to)}${quote}`;
    });
    // On the first line, so line numbers stay the same.
    code = `try { import.meta.url = ${JSON.stringify(pathToFileURL(src).href)}; } catch {} ${code}`;
    writeIfChanged(out, code);
    return out;
  };
  return visit(entry);
}

// --- Stack traces ---------------------------------------------------------------

const BUILT = /(?:file:\/\/)?((?:\/[^/\s:()]+)*?)\/\.tide\/build\/([^\s:()]+?\.(?:ts|tsx|mts|cts))\.[cm]js/g;

/**
 * Maps compiled paths in a stack trace or message back to the sources:
 * file:///p/.tide/build/src/a.ts.mjs:3:7 -> /p/src/a.ts:3:7.
 * @param {string} text
 */
function mapStack(text) {
  return text.replace(BUILT, (m, base, rel) => `${base}/${rel.split('/').map((/** @type {string} */ s) => (s === '_up' ? '..' : s)).join('/')}`);
}

/** Node's own stack format, with compiled paths mapped back. */
function installStackMapping() {
  // Leave a script's own formatter (source-map-support and the like) alone.
  if (/** @type {any} */ (Error).prepareStackTrace) return;
  Error.prepareStackTrace = (error, frames) => {
    let head;
    try {
      head = String(error);
    } catch {
      head = 'Error';
    }
    return mapStack(frames.length ? `${head}\n    at ${frames.join('\n    at ')}` : head);
  };
}

/**
 * Sets up the hooks for running a TypeScript entry and starts it.
 * @param {string} entry absolute path
 */
function runTypeScript(entry) {
  installRequireHook();
  const Module = /** @type {any} */ (require('module'));
  if (formatOf(entry) === 'cjs') {
    // What Module.runMain does for CommonJS; it would send .ts in a "type": "module" package to the ESM loader.
    Module._load(entry, null, true);
    return;
  }
  installStackMapping();
  Module.runMain(buildEsm(entry));
}

module.exports = { isTs, formatOf, compile, resolveRelative, installRequireHook, buildEsm, outPath, mapStack, runTypeScript };
