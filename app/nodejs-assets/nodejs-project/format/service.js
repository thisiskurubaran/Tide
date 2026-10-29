// @ts-check
// Format & Lint: Prettier and ESLint, bundled into bundle.js by
// scripts/build-services.js. Paths in requests are relative to the app's
// Documents directory, which is the cwd this service starts in.
'use strict';

const fs = require('fs');
const path = require('path');
const { serve } = require('../service');

// The supervisor sets PWD per run; process.cwd() is shared with every other run.
const ROOT = process.env.PWD || process.cwd();
/** @type {any} */
let tools = null;
const load = () => (tools ??= require('./bundle'));

/** @type {Record<string, string>} */
const PARSERS = {
  js: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  jsx: 'babel',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
};

const ext = (/** @type {string} */ file) => path.extname(file).slice(1).toLowerCase();

/** @param {string} abs */
function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

// The nearest Prettier config between the file and the project folder. Only
// JSON configs are read; JS configs would mean running project code here.
/** @param {string} file absolute */
function prettierConfig(file, project) {
  for (let dir = path.dirname(file); dir.startsWith(project); dir = path.dirname(dir)) {
    for (const name of ['.prettierrc', '.prettierrc.json']) {
      const config = readJson(path.join(dir, name));
      if (config) return config;
    }
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg && typeof pkg.prettier === 'object') return pkg.prettier;
    if (dir === project || dir === path.dirname(dir)) break;
  }
  return {};
}

/** @param {string} rel e.g. projects/app/src/a.js */
function projectDir(rel) {
  const [top, name] = rel.split('/');
  return path.join(ROOT, top, name || '');
}

async function format({ path: rel, content }) {
  const parser = PARSERS[ext(rel)];
  if (!parser) throw new Error(`no formatter for .${ext(rel)} files`);
  const { prettier, plugins } = load();
  const abs = path.join(ROOT, rel);
  const config = prettierConfig(abs, projectDir(rel));
  // Options that point at plugins or files can't work here.
  delete config.plugins;
  delete config.overrides;
  return prettier.format(content, { ...config, parser, plugins, filepath: abs });
}

const LINTABLE = new Set(['js', 'mjs', 'cjs', 'jsx']);

/** @type {any} */
let linter = null;

function lint({ path: rel, content }) {
  const e = ext(rel);
  if (!LINTABLE.has(e)) return [];
  const { Linter, js, globals } = load();
  linter ??= new Linter({ configType: 'flat' });
  const config = [
    js.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: e === 'cjs' ? 'commonjs' : 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
      },
      rules: {
        // Unused arguments and caught errors are common and harmless in scripts.
        'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      },
    },
  ];
  return linter.verify(content, config, { filename: rel }).map((/** @type {any} */ m) => ({
    line: m.line || 1,
    column: m.column || 1,
    endLine: m.endLine || m.line || 1,
    endColumn: m.endColumn || (m.column || 1) + 1,
    severity: m.severity === 2 ? 'error' : 'warning',
    message: m.ruleId ? `${m.message} (${m.ruleId})` : m.message,
  }));
}

serve({
  format,
  lint,
  supports: () => ({ format: Object.keys(PARSERS), lint: [...LINTABLE] }),
});
