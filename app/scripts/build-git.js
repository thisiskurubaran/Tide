// Bundles isomorphic-git and its Node HTTP client into one file inside the
// nodejs-mobile project, which has no node_modules of its own. The output is
// committed, like the WebView bundles; rerun after upgrading isomorphic-git.
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '..', 'nodejs-assets', 'nodejs-project', 'git', 'isogit.js');

esbuild
  .build({
    stdin: {
      contents: "module.exports = { git: require('isomorphic-git'), http: require('isomorphic-git/http/node') };",
      resolveDir: path.join(__dirname, '..'),
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
    logLevel: 'warning',
  })
  .then(() => console.log(`wrote ${path.relative(process.cwd(), out)}`))
  .catch(() => process.exit(1));
