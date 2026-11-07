// Bundles ssh2 into one file inside the nodejs-mobile project, which has no
// node_modules of its own. Its optional native addons (cpu-features and the
// sshcrypto binding) stay out; ssh2 falls back to Node's crypto without them.
// nodejs-mobile on iOS has no WebAssembly, which ssh2's poly1305 needs, and its
// start-up waits on loading it; a stub stands in, and tide:ssh turns the
// chacha20-poly1305 cipher off (AES-GCM and the others don't need it).
// The output is committed, like the other bundles; rerun after upgrading ssh2.
const path = require('path');
const esbuild = require('esbuild');

const out = path.join(__dirname, '..', 'nodejs-assets', 'nodejs-project', 'ssh', 'ssh2.js');

esbuild
  .build({
    stdin: { contents: "module.exports = require('ssh2');", resolveDir: path.join(__dirname, '..'), loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // nodejs-mobile is Node 18.
    target: 'node18',
    minify: true,
    legalComments: 'inline',
    external: ['cpu-features', '*.node'],
    plugins: [
      {
        name: 'no-wasm-poly1305',
        setup(build) {
          build.onResolve({ filter: /crypto\/poly1305\.js$/ }, () => ({ path: 'poly1305-stub', namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              "module.exports = () => Promise.resolve({ _malloc: () => 0, cwrap: () => () => { throw new Error('chacha20-poly1305 is not available'); } });",
            loader: 'js',
          }));
        },
      },
    ],
    outfile: out,
    logLevel: 'warning',
  })
  .then(() => console.log(`wrote ${path.relative(process.cwd(), out)}`))
  .catch(() => process.exit(1));
