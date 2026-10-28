import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    // The editor ships inside the app, so everything (fonts included) is inlined.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
});
