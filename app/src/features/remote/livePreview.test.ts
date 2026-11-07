import { bufferKey } from '../../state/buffers';
import { categoryScore } from './devtools/audit';
import { emptyDevtools, reduce } from './devtools/devtools';
import { layoutFor, onlyStyles, savedPaths } from './livePreview';

describe('live preview', () => {
  it('frames narrower widths and scales wider ones', () => {
    expect(layoutFor(null, 400)).toEqual({ frame: null, pageWidth: null });
    expect(layoutFor(390, 1024)).toEqual({ frame: 390, pageWidth: null });
    expect(layoutFor(1280, 393)).toEqual({ frame: null, pageWidth: 1280 });
  });

  it('notices which files of the project were saved, and whether only CSS changed', () => {
    const prev = { [bufferKey('p', 'style.css')]: { content: 'a', saved: 'a' }, [bufferKey('p', 'app.js')]: { content: 'x', saved: 'x' }, [bufferKey('q', 'x.css')]: { content: '', saved: '' } };
    const next = { ...prev, [bufferKey('p', 'style.css')]: { content: 'b', saved: 'b' }, [bufferKey('q', 'x.css')]: { content: '1', saved: '1' } };
    expect(savedPaths(prev, next, 'p')).toEqual(['style.css']);
    expect(onlyStyles(['style.css', 'theme.CSS'])).toBe(true);
    expect(onlyStyles(['style.css', 'app.js'])).toBe(false);
    expect(onlyStyles([])).toBe(false);
  });

  it('keeps the latest page checks and scores them', () => {
    const checks = [
      { id: 'a', category: 'seo' as const, title: 'A', ok: true },
      { id: 'b', category: 'seo' as const, title: 'B', ok: false },
      { id: 'c', category: 'seo' as const, title: 'C', ok: true, info: true },
    ];
    const s = reduce(emptyDevtools(), { kind: 'audit', id: 1, url: 'http://localhost:3000/', checks, time: 5 });
    expect(s.audit).toEqual({ url: 'http://localhost:3000/', time: 5, checks });
    expect(categoryScore(checks, 'seo')).toBe(50);
    expect(categoryScore(checks, 'performance')).toBeNull();
  });
});
