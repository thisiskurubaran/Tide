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

  it('keeps font sizes in range', () => {
    const settings = createSettingsStore(createFsStorage(createMemoryFs()));
    settings.getState().setTerminalFontSize(100);
    expect(settings.getState().terminalFontSize).toBe(24);
    settings.getState().setTerminalFontSize(2);
    expect(settings.getState().terminalFontSize).toBe(10);
  });
});
