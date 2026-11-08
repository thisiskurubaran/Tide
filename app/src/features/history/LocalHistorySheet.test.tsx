import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockEdit = jest.fn();
const mockSave = jest.fn(async () => undefined);
jest.mock('../../state', () => ({
  buffersStore: { getState: () => ({ buffers: { 'p\u0000a.txt': { content: 'new text', saved: 'new text' } }, edit: mockEdit, save: mockSave }) },
  settingsStore: { getState: () => ({ haptics: false }) },
  useSettings: (select: (s: object) => unknown) => select({ theme: 'dark', contrast: 'system', editorFontSize: 14 }),
}));
const mockKeepNext = jest.fn();
jest.mock('.', () => ({
  fileHistory: {
    keepNext: (...args: unknown[]) => mockKeepNext(...args),
    list: async () => [
      { id: '2000.txt', time: 2000, bytes: 8 },
      { id: '1000.txt', time: 1000, bytes: 8 },
    ],
    read: async (_p: string, _f: string, id: string) => (id === '1000.txt' ? 'old text' : 'new text'),
  },
}));

import { LocalHistorySheet } from './LocalHistorySheet';

it('lists versions, compares one with the current text and restores it', async () => {
  const onClose = jest.fn();
  await render(<LocalHistorySheet project="p" path="a.txt" onClose={onClose} />);
  await waitFor(() => expect(screen.getByTestId('history-version-1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('history-version-1'));
  await waitFor(() => expect(screen.getAllByText(/new text/).length).toBeGreaterThan(0));
  await fireEvent.press(screen.getByTestId('history-restore'));
  await waitFor(() => expect(mockSave).toHaveBeenCalledWith('p', 'a.txt'));
  expect(mockEdit).toHaveBeenCalledWith('p', 'a.txt', 'old text');
  // The restore gets a version of its own, so the text it replaced is kept.
  expect(mockKeepNext).toHaveBeenCalledWith('p', 'a.txt');
  expect(mockKeepNext.mock.invocationCallOrder[0]).toBeLessThan(mockEdit.mock.invocationCallOrder[0]);
  expect(onClose).toHaveBeenCalled();
});
