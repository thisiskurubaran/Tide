// Bundles the Postgres (pg) and MySQL (mysql2) drivers into one file inside the
// nodejs-mobile project, which has no node_modules of its own. Both are plain
// JavaScript over Node's net and tls. pg's optional native binding and its
// Cloudflare Workers socket stay out.
// The output is committed, like the other bundles; rerun after upgrading them.
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '..', 'nodejs-assets', 'nodejs-project', 'sql', 'drivers.js');

esbuild
  .build({
    stdin: { contents: "module.exports = { pg: require('pg'), mysql: require('mysql2/promise') };", resolveDir: path.join(__dirname, '..'), loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // nodejs-mobile is Node 18.
    target: 'node18',
    minify: true,
    legalComments: 'inline',
    external: ['pg-native', 'cloudflare:sockets', 'pg-cloudflare'],
    outfile: out,
    logLevel: 'warning',
  })
  .then(() => console.log(`wrote ${path.relative(process.cwd(), out)}`))
  .catch(() => process.exit(1));
