import { previewNavigation } from './navigation';

describe('previewNavigation', () => {
  const local = 'http://127.0.0.1:3000/';
  const remote = 'https://tide.example.com/preview/abc/3000/';

  it('keeps pages of the project server in the preview', () => {
    expect(previewNavigation('http://127.0.0.1:3000/about', local)).toBe('allow');
    expect(previewNavigation('http://localhost:5173/', local)).toBe('allow');
    expect(previewNavigation('https://tide.example.com/preview/abc/8080/', remote)).toBe('allow');
    expect(previewNavigation('about:blank', local)).toBe('allow');
  });

  it('opens other websites in Safari', () => {
    expect(previewNavigation('https://www.google.com/', local)).toBe('external');
    expect(previewNavigation('https://example.com/', remote)).toBe('external');
    expect(previewNavigation('mailto:a@b.c', local)).toBe('external');
  });

  it('lets embedded frames load, and blocks other schemes', () => {
    expect(previewNavigation('https://www.youtube.com/embed/x', local, false)).toBe('allow');
    expect(previewNavigation('javascript:alert(1)', local)).toBe('block');
    expect(previewNavigation('itms-apps://x', local)).toBe('block');
  });
});

describe('previews of project HTML files', () => {
  const start = 'file:///var/mobile/Documents/projects/site/index.html';
  it('stays inside the project folder', () => {
    expect(previewNavigation('file:///var/mobile/Documents/projects/site/about.html', start)).toBe('allow');
    expect(previewNavigation('file:///var/mobile/Documents/projects/site/blog/post.html#top', start)).toBe('allow');
    expect(previewNavigation('file:///var/mobile/Documents/projects/other/index.html', start)).toBe('block');
    expect(previewNavigation('file:///var/mobile/Documents/projects/site/../other/x.html', start)).toBe('block');
    expect(previewNavigation('file:///etc/passwd', start)).toBe('block');
    expect(previewNavigation('https://example.com/', start)).toBe('external');
  });
});
