// Builds the third-party code the Node services need into the nodejs-mobile
// project, which has no node_modules of its own:
//   format/bundle.js         Prettier (with its plugins) and ESLint, for Format & Lint
//   intellisense/typescript.js and intellisense/lib/*.d.ts, for IntelliSense Pro
// The output is several MB, so it is generated on npm install, not committed.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const app = path.join(__dirname, '..');
const project = path.join(app, 'nodejs-assets', 'nodejs-project');

async function formatBundle() {
  const out = path.join(project, 'format', 'bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        const prettier = require('prettier/standalone');
        const plugins = ['babel', 'estree', 'typescript', 'postcss', 'html', 'markdown', 'yaml'].map((p) => require('prettier/plugins/' + p));
        module.exports = { prettier, plugins, Linter: require('eslint/universal').Linter, js: require('@eslint/js'), globals: require('globals') };`,
      resolveDir: app,
      loader: 'js',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // nodejs-mobile is Node 18.
    target: 'node18',
    minify: true,
    legalComments: 'inline',
    outfile: out,
    logLevel: 'error',
  });
  return out;
}

async function typescriptBundle() {
  const ts = path.dirname(require.resolve('typescript/package.json', { paths: [app] }));
  const dir = path.join(project, 'intellisense');
  const out = path.join(dir, 'typescript.js');
  await esbuild.build({
    entryPoints: [path.join(ts, 'lib', 'typescript.js')],
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    minify: true,
    legalComments: 'inline',
    outfile: out,
    logLevel: 'error',
  });
  // The language service reads the default library files from disk.
  const libDir = path.join(dir, 'lib');
  fs.rmSync(libDir, { recursive: true, force: true });
  fs.mkdirSync(libDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(ts, 'lib'))) {
    if (/^lib\..*\.d\.ts$/.test(name)) fs.copyFileSync(path.join(ts, 'lib', name), path.join(libDir, name));
  }
  return out;
}

Promise.all([formatBundle(), typescriptBundle()])
  .then((outs) => {
    for (const out of outs) console.log(`wrote ${path.relative(app, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
