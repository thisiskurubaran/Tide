import { createMemoryFs } from '../features/files/memoryFs';
import { createSettingsStore } from './settings';
import { createFsStorage } from './storage';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings store', () => {
  it('defaults to dark and persists changes', async () => {
    const storage = createFsStorage(createMemoryFs());
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().theme).toBe('dark');
    settings.getState().setTheme('light');
    settings.getState().setEditorFontSize(18);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().theme).toBe('light');
    expect(restarted.getState().editorFontSize).toBe(18);
  });

  it('keeps crash reports off until turned on, including for settings saved before the option existed', async () => {
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('settings', JSON.stringify({ state: { theme: 'light', editorFontSize: 15, terminalFontSize: 13 }, version: 1 }));
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().theme).toBe('light');
    expect(settings.getState().crashReports).toBe(false);
    settings.getState().setCrashReports(true);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().crashReports).toBe(true);
  });

  it('keeps font sizes in range', () => {
    const settings = createSettingsStore(createFsStorage(createMemoryFs()));
    settings.getState().setTerminalFontSize(100);
    expect(settings.getState().terminalFontSize).toBe(24);
    settings.getState().setTerminalFontSize(2);
    expect(settings.getState().terminalFontSize).toBe(10);
  });

  it('defaults editor options for a phone and remembers changes', async () => {
    const storage = createFsStorage(createMemoryFs());
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState()).toMatchObject({ wordWrap: true, folding: true, indentGuides: true, minimap: false });
    settings.getState().setEditorOption('minimap', true);
    settings.getState().setEditorOption('wordWrap', false);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState()).toMatchObject({ wordWrap: false, minimap: true });
  });

  it('keeps the editor key bindings', async () => {
    const storage = createFsStorage(createMemoryFs());
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().keymap).toBe('standard');
    settings.getState().setKeymap('vim');
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().keymap).toBe('vim');
  });
});
