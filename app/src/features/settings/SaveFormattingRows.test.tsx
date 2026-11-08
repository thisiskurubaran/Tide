import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createFsStorage } = jest.requireActual('../../state/storage');
  const { createSettingsStore } = jest.requireActual('../../state/settings');
  const { useStore } = jest.requireActual('zustand');
  const settingsStore = createSettingsStore(createFsStorage(createMemoryFs()));
  return { settingsStore, useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel) };
});

import { settingsStore } from '../../state';
import { SaveFormattingRows } from './SaveFormattingRows';

it('shows both save switches off, mentions the Markdown exception, and saves them', async () => {
  await render(<SaveFormattingRows />);
  expect(screen.getByText('Trim trailing whitespace on save')).toBeTruthy();
  expect(screen.getByText(/Markdown line are a line break and stay/)).toBeTruthy();
  expect(screen.getByTestId('editor-trimTrailingWhitespace').props.value).toBe(false);
  expect(screen.getByTestId('editor-insertFinalNewline').props.value).toBe(false);

  await act(async () => fireEvent(screen.getByTestId('editor-trimTrailingWhitespace'), 'valueChange', true));
  await act(async () => fireEvent(screen.getByTestId('editor-insertFinalNewline'), 'valueChange', true));
  expect(settingsStore.getState().trimTrailingWhitespace).toBe(true);
  expect(settingsStore.getState().insertFinalNewline).toBe(true);
  expect(screen.getByTestId('editor-insertFinalNewline').props.value).toBe(true);
});
