// The Ruby and PHP runtimes: a page (web/runtimes) and the interpreters it
// runs, all in assets/runtimes so they ship as files next to each other.
//
//   node scripts/build-runtimes.js         copies the .wasm files (npm install runs this)
//   node scripts/build-runtimes.js --page  also rebuilds runtime.html, which is committed
//
// The .wasm files (about 49 MB) come from node_modules and aren't committed.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'assets', 'runtimes');
fs.mkdirSync(out, { recursive: true });

const binaries = {
  'ruby.wasm': 'node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm',
  'php.wasm': 'node_modules/@php-wasm/web-8-3/asyncify/8_3_33/php_8_3.wasm',
};
for (const [name, from] of Object.entries(binaries)) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.warn(`build-runtimes: ${from} is missing; run npm install`);
    continue;
  }
  fs.copyFileSync(src, path.join(out, name));
  console.log(`copied ${name} (${(fs.statSync(src).size / 1024 / 1024).toFixed(1)} MB)`);
}

if (process.argv.includes('--page')) {
  const dir = path.join(root, 'web', 'runtimes');
  execFileSync(path.join(root, 'node_modules', '.bin', 'vite'), ['build', '--config', path.join(dir, 'vite.runtimes.mjs')], { cwd: root, stdio: 'inherit' });
  fs.copyFileSync(path.join(dir, 'dist', 'index.html'), path.join(out, 'runtime.html'));
  console.log(`wrote assets/runtimes/runtime.html (${(fs.statSync(path.join(out, 'runtime.html')).size / 1024).toFixed(0)} KB)`);
}
