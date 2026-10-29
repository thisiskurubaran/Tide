import { localImages, markdownToHtml, notebookToHtml, previewKind } from './render';

describe('preview rendering', () => {
  it('knows which files it previews', () => {
    expect(previewKind('README.md')).toBe('markdown');
    expect(previewKind('nb/analysis.ipynb')).toBe('notebook');
    expect(previewKind('index.js')).toBeNull();
  });

  it('renders GitHub-flavoured Markdown', () => {
    const html = markdownToHtml('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('checkbox');
  });

  it('renders notebook cells and outputs', () => {
    const nb = {
      metadata: { language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['## Intro\n', 'Some *text*'] },
        {
          cell_type: 'code',
          execution_count: 3,
          source: 'print(1 < 2)',
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['True\n'] },
            { output_type: 'display_data', data: { 'image/png': 'iVBOR\nw0K', 'text/plain': '<Figure>' } },
            { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['\u001b[31mValueError\u001b[0m: bad'] },
          ],
        },
      ],
    };
    const html = notebookToHtml(JSON.stringify(nb));
    expect(html).toContain('<h2>Intro</h2>');
    expect(html).toContain('In [3]');
    expect(html).toContain('print(1 &lt; 2)');
    expect(html).toContain('src="data:image/png;base64,iVBORw0K"');
    expect(html).not.toContain('&lt;Figure&gt;');
    expect(html).toContain('ValueError: bad');
    expect(html).not.toContain('\u001b');
  });

  it('explains a notebook it cannot read', () => {
    expect(notebookToHtml('{')).toContain('could not be read');
  });

  it('finds local images relative to the file', () => {
    const html = markdownToHtml('![a](./img/a.png) ![b](../logo.svg) ![c](https://x.dev/c.png)');
    expect(localImages(html, 'docs/guide.md')).toEqual([
      { src: './img/a.png', path: 'docs/img/a.png' },
      { src: '../logo.svg', path: 'logo.svg' },
    ]);
  });
});
