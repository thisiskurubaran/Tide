/**
 * @jest-environment node
 */
/// <reference types="node" />
// Writes a preview page with a diagram for scripts/test-mermaid.js to open in Chromium.
import fs from 'fs';

import { hasMermaid, markdownToHtml, mermaidScripts, previewPage } from './render';

const colors = { background: '#fff', foreground: '#000', muted: '#666', border: '#ccc', code: '#eee', link: '#00f', error: '#f00' };

it('turns mermaid blocks into diagrams and only runs nonce scripts', () => {
  const body = markdownToHtml('# Flow\n\n```mermaid\ngraph TD; A[Start] --> B{Ok?}; B -->|yes| C[Done]\n```\n\n<script>window.injected = true</script>\n\n```js\nconst a = 1;\n```\n');
  expect(hasMermaid(body)).toBe(true);
  expect(body).toContain('<pre class="mermaid">graph TD; A[Start] --&gt; B{Ok?};');
  expect(body).toContain('<code class="language-js">');
  const page = previewPage(body, colors, 14, mermaidScripts('/* library */', false, 'n0nce'));
  expect(page).toContain("script-src 'nonce-n0nce'");
  expect(page).toContain('<script nonce="n0nce">/* library */</script>');
  expect(previewPage('x', colors, 14)).not.toContain('script-src');
  if (process.env.TIDE_MERMAID_OUT) {
    const lib = fs.readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
    fs.writeFileSync(process.env.TIDE_MERMAID_OUT, previewPage(body, colors, 14, mermaidScripts(lib, false, 'n0nce')));
  }
});
