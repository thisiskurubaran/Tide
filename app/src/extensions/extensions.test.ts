import { createMemoryFs } from '../features/files/memoryFs';
import { createFsStorage } from '../state/storage';
import { createDiagnosticsStore, fileDiagnostics, lineStarts, offsetAt, positionAt } from './diagnostics';
import { manifests } from './manifests';
import { createExtensionsStore, DEFAULT_PREFS, isActive } from './store';
import { fileIconFor } from './themes/fileIcons';
import { colorThemes } from './themes/catalog';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('manifests', () => {
  it('lists every extension once', () => {
    expect(manifests.map((m) => m.id)).toEqual(['themes', 'format-lint', 'git-pro', 'intellisense', 'debugger']);
  });
});

describe('extensions store', () => {
  it('installs and removes extensions, and remembers them', async () => {
    const storage = createFsStorage(createMemoryFs());
    const store = createExtensionsStore(storage);
    await flush();
    expect(isActive(store.getState(), 'themes')).toBe(false);
    store.getState().install('debugger');
    store.getState().install('themes');
    store.getState().install('themes');
    expect(store.getState().installed).toEqual(['themes', 'debugger']);
    expect(isActive(store.getState(), 'themes')).toBe(true);
    store.getState().uninstall('debugger');
    expect(isActive(store.getState(), 'debugger')).toBe(false);
    await flush();
    const restarted = createExtensionsStore(storage);
    await flush();
    expect(restarted.getState().installed).toEqual(['themes']);
  });

  it('remembers turned-down suggestions per project', async () => {
    const storage = createFsStorage(createMemoryFs());
    const store = createExtensionsStore(storage);
    store.getState().dismiss('demo', 'git-pro');
    store.getState().dismiss('demo', 'git-pro');
    store.getState().dismiss('other', 'intellisense');
    expect(store.getState().dismissed).toEqual({ demo: ['git-pro'], other: ['intellisense'] });
    await flush();
    const restarted = createExtensionsStore(storage);
    await flush();
    expect(restarted.getState().dismissed.demo).toEqual(['git-pro']);
  });

  it('ignores extensions it no longer knows when loading', async () => {
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('extensions', JSON.stringify({ state: { installed: ['gone', 'git-pro'], prefs: { formatOnSave: true } }, version: 2 }));
    const store = createExtensionsStore(storage);
    await flush();
    expect(store.getState().installed).toEqual(['git-pro']);
    expect(store.getState().prefs).toEqual({ ...DEFAULT_PREFS, formatOnSave: true });
  });
});

describe('diagnostics', () => {
  it('merges sources per file, sorted by position, and clears a source', () => {
    const store = createDiagnosticsStore();
    const d = (from: number, source: string) => ({ from, to: from + 1, line: 1, column: from + 1, severity: 'warning' as const, message: 'm', source });
    store.getState().set('p', 'a.js', 'eslint', [d(5, 'eslint')]);
    store.getState().set('p', 'a.js', 'ts', [d(2, 'ts')]);
    expect(fileDiagnostics(store.getState(), 'p', 'a.js').map((x) => x.source)).toEqual(['ts', 'eslint']);
    store.getState().clearSource('ts');
    expect(fileDiagnostics(store.getState(), 'p', 'a.js').map((x) => x.source)).toEqual(['eslint']);
    store.getState().set('p', 'a.js', 'eslint', []);
    expect(store.getState().byProject.p).toEqual({});
  });

  it('converts between offsets and 1-based lines and columns', () => {
    const text = 'ab\ncde\n\nf';
    const starts = lineStarts(text);
    expect(offsetAt(starts, text, 2, 2)).toBe(4);
    expect(positionAt(starts, 4)).toEqual({ line: 2, column: 2 });
    expect(offsetAt(starts, text, 2, 99)).toBe(6);
    expect(positionAt(starts, text.length)).toEqual({ line: 4, column: 2 });
  });
});

describe('themes pack', () => {
  it('uses six-digit hex colors, which the editor adds alpha to', () => {
    for (const t of colorThemes) {
      const colors = [...Object.values(t.editor).filter((v) => typeof v === 'string'), ...Object.values(t.editor.syntax), ...Object.values(t.terminal)];
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('picks file icons by name, then extension', () => {
    expect(fileIconFor('package.json')).toMatchObject({ kind: 'icon', name: 'package' });
    expect(fileIconFor('app.TSX')).toMatchObject({ kind: 'label', text: 'TSX' });
    expect(fileIconFor('.env.local')).toMatchObject({ name: 'key' });
    expect(fileIconFor('Makefile')).toBeNull();
  });
});
