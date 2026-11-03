// The Ruby and PHP runtimes: a page (web/runtimes) and the interpreters it
// runs, all in assets/runtimes so they ship as files next to each other.
//
//   node scripts/build-runtimes.js         copies the .wasm files (npm install runs this)
//   node scripts/build-runtimes.js --page  also rebuilds runtime.html and ruff.html, which are committed
//   node scripts/build-runtimes.js --ruff  rebuilds only ruff.html
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

// Mermaid, for diagrams in Markdown previews (5.5 MB). It ships as a file the
// preview reads only when a document has a diagram, rather than in the JS bundle.
const mermaid = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
if (fs.existsSync(mermaid)) {
  fs.mkdirSync(path.join(root, 'assets', 'mermaid'), { recursive: true });
  fs.copyFileSync(mermaid, path.join(root, 'assets', 'mermaid', 'mermaid.js.txt'));
  console.log('copied mermaid.js.txt');
} else console.warn('build-runtimes: mermaid is missing; run npm install');

// KaTeX, for math in Markdown previews, the same way: its script, and its CSS
// with the woff2 fonts inlined (the preview page can only load data: fonts).
const katex = path.join(root, 'node_modules', 'katex', 'dist');
if (fs.existsSync(katex)) {
  const dir = path.join(root, 'assets', 'katex');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(katex, 'katex.min.js'), path.join(dir, 'katex.js.txt'));
  const css = fs.readFileSync(path.join(katex, 'katex.min.css'), 'utf8').replace(/src:url\(fonts\/([\w-]+\.woff2)\) format\("woff2"\)[^;}]*/g, (_, font) => {
    const data = fs.readFileSync(path.join(katex, 'fonts', font)).toString('base64');
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
  fs.writeFileSync(path.join(dir, 'katex.css.txt'), css);
  console.log(`copied katex.js.txt and katex.css.txt (${(css.length / 1024).toFixed(0)} KB)`);
} else console.warn('build-runtimes: katex is missing; run npm install');

// Ruff, for Python lint and format in Format & Lint: its WebAssembly module
// next to the page that runs it (assets/ruff/ruff.html, committed).
const ruff = path.join(root, 'node_modules', '@astral-sh', 'ruff-wasm-web', 'ruff_wasm_bg.wasm');
if (fs.existsSync(ruff)) {
  fs.mkdirSync(path.join(root, 'assets', 'ruff'), { recursive: true });
  fs.copyFileSync(ruff, path.join(root, 'assets', 'ruff', 'ruff.wasm'));
  console.log(`copied ruff.wasm (${(fs.statSync(ruff).size / 1024 / 1024).toFixed(1)} MB)`);
} else console.warn('build-runtimes: @astral-sh/ruff-wasm-web is missing; run npm install');

if (process.argv.includes('--page')) {
  const dir = path.join(root, 'web', 'runtimes');
  execFileSync(path.join(root, 'node_modules', '.bin', 'vite'), ['build', '--config', path.join(dir, 'vite.runtimes.mjs')], { cwd: root, stdio: 'inherit' });
  fs.copyFileSync(path.join(dir, 'dist', 'index.html'), path.join(out, 'runtime.html'));
  console.log(`wrote assets/runtimes/runtime.html (${(fs.statSync(path.join(out, 'runtime.html')).size / 1024).toFixed(0)} KB)`);
}

// The Ruff page: node scripts/build-runtimes.js --page (or --ruff for just this one).
if (process.argv.includes('--page') || process.argv.includes('--ruff')) {
  const dir = path.join(root, 'web', 'ruff');
  execFileSync(path.join(root, 'node_modules', '.bin', 'vite'), ['build', '--config', path.join(dir, 'vite.ruff.mjs')], { cwd: root, stdio: 'inherit' });
  fs.copyFileSync(path.join(dir, 'dist', 'index.html'), path.join(root, 'assets', 'ruff', 'ruff.html'));
  console.log(`wrote assets/ruff/ruff.html (${(fs.statSync(path.join(root, 'assets', 'ruff', 'ruff.html')).size / 1024).toFixed(0)} KB)`);
}
