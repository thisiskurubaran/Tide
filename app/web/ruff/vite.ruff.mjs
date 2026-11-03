import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// ruff.wasm (10 MB) stays a separate file next to the page; the app hands its
// URL over at start. The glue's own `new URL('ruff_wasm_bg.wasm', import.meta.url)`
// default is cut so the binary isn't inlined.
const noWasmUrl = {
  name: 'no-wasm-url',
  transform(code, id) {
    if (!/ruff-wasm-web/.test(id)) return null;
    return code.replace(/new URL\((['"])[^'"]+\.wasm\1,\s*import\.meta\.url\)/g, '"tide-unused.wasm"');
  },
};

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [noWasmUrl, viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
});
