import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The interpreters (.wasm) stay separate files next to the page; the app hands
// their URLs over at start. Their loaders' own `new URL('…wasm', import.meta.url)`
// references are cut so the 18-30 MB binaries aren't inlined.
const noWasmUrls = {
  name: 'no-wasm-urls',
  transform(code, id) {
    if (!/php_8_3\.js$|@php-wasm|@ruby/.test(id)) return null;
    return code.replace(/new URL\((['"])[^'"]+\.(wasm|so)\1,\s*import\.meta\.url\)/g, '"tide-unused.$2"');
  },
};

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [noWasmUrls, viteSingleFile()],
  resolve: {
    alias: {
      // Not in the package's exports; the asyncify build is the one WebKit can run.
      'tide-php-loader': fileURLToPath(new URL('../../node_modules/@php-wasm/web-8-3/asyncify/php_8_3.js', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
});
