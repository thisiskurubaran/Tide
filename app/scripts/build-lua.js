// Bundles fengari (Lua 5.3 in plain JavaScript) into one file inside the
// nodejs-mobile project, which has no node_modules of its own. The output is
// committed, like the other bundles; rerun after upgrading fengari.
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '..', 'nodejs-assets', 'nodejs-project', 'lua', 'fengari.js');

esbuild
  .build({
    stdin: { contents: "module.exports = require('fengari');", resolveDir: path.join(__dirname, '..'), loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // nodejs-mobile is Node 18.
    target: 'node18',
    minify: true,
    legalComments: 'inline',
    outfile: out,
    logLevel: 'warning',
  })
  .then(() => console.log(`wrote ${path.relative(process.cwd(), out)}`))
  .catch(() => process.exit(1));
