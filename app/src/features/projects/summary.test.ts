import { summarizeLanguages } from './summary';

describe('summarizeLanguages', () => {
  it('leads with the most common language', () => {
    const s = summarizeLanguages(['index.html', 'about.html', 'style.css', 'app.js', 'README.md']);
    expect(s.badge?.text).toBe('<>');
    expect(s.languages).toEqual(['HTML', 'CSS', 'JS']);
  });

  it('ranks code above JSON and Markdown', () => {
    const s = summarizeLanguages(['package.json', 'tsconfig.json', 'README.md', 'src/index.ts']);
    expect(s.badge?.text).toBe('TS');
    expect(s.languages).toEqual(['TS', 'JSON', 'Markdown']);
  });

  it('skips config and images, and handles empty projects', () => {
    expect(summarizeLanguages(['.env', 'logo.png', 'main.py']).languages).toEqual(['Python']);
    expect(summarizeLanguages([])).toEqual({ badge: null, languages: [] });
  });
});
