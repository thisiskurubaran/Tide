import { createMemoryFs } from '../features/files/memoryFs';
import { ALL_GESTURES } from '../features/editor/bridge';
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

  it('defaults to JetBrains Mono without ligatures, including for settings saved before the option existed', async () => {
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('settings', JSON.stringify({ state: { theme: 'light', editorFontSize: 15 }, version: 1 }));
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState()).toMatchObject({ codeFont: 'jetbrains-mono', ligatures: false });
    settings.getState().setCodeFont('fira-code');
    settings.getState().setLigatures(true);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState()).toMatchObject({ codeFont: 'fira-code', ligatures: true });
  });

  it('matches the app chrome to the color theme by default, and remembers turning it off', async () => {
    const storage = createFsStorage(createMemoryFs());
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().matchChrome).toBe(true);
    settings.getState().setMatchChrome(false);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().matchChrome).toBe(false);
  });

  it('has every gesture on by default and saves each switch', async () => {
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('settings', JSON.stringify({ state: { theme: 'dark', editorFontSize: 14, terminalFontSize: 13 }, version: 1 }));
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().gestures).toEqual(ALL_GESTURES);
    settings.getState().setGesture('undo', false);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().gestures).toEqual({ ...ALL_GESTURES, undo: false });
  });

  it('keeps trim trailing whitespace and insert final newline off until turned on, and saves them', async () => {
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('settings', JSON.stringify({ state: { theme: 'dark', editorFontSize: 14, terminalFontSize: 13 }, version: 1 }));
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().trimTrailingWhitespace).toBe(false);
    expect(settings.getState().insertFinalNewline).toBe(false);
    settings.getState().setEditorOption('trimTrailingWhitespace', true);
    settings.getState().setEditorOption('insertFinalNewline', true);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().trimTrailingWhitespace).toBe(true);
    expect(restarted.getState().insertFinalNewline).toBe(true);
  });

  it('keeps the screen awake while running by default, including for settings saved before the option, and remembers it off', async () => {
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('settings', JSON.stringify({ state: { theme: 'light' }, version: 1 }));
    const settings = createSettingsStore(storage);
    await flush();
    expect(settings.getState().keepAwake).toBe(true);
    settings.getState().setKeepAwake(false);
    await flush();
    const restarted = createSettingsStore(storage);
    await flush();
    expect(restarted.getState().keepAwake).toBe(false);
  });
});
