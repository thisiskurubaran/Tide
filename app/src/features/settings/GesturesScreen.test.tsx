import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createFsStorage } = jest.requireActual('../../state/storage');
  const { createSettingsStore } = jest.requireActual('../../state/settings');
  const { useStore } = jest.requireActual('zustand');
  const settingsStore = createSettingsStore(createFsStorage(createMemoryFs()));
  return { settingsStore, useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel) };
});

import { settingsStore } from '../../state';
import { GesturesScreen } from './GesturesScreen';

it('lists each gesture with a switch, all on, and saves a change', async () => {
  await render(<GesturesScreen />);
  for (const key of ['tabs', 'pinch', 'undo', 'pullPalette', 'twoFingerTap']) {
    expect(screen.getByTestId(`gesture-${key}`).props.value).toBe(true);
  }
  expect(screen.getByText(/Gestures never type into your code\. They turn off while VoiceOver is running\./)).toBeTruthy();
  await act(async () => fireEvent(screen.getByTestId('gesture-pullPalette'), 'valueChange', false));
  expect(settingsStore.getState().gestures.pullPalette).toBe(false);
  expect(screen.getByTestId('gesture-pullPalette').props.value).toBe(false);
  expect(settingsStore.getState().gestures.tabs).toBe(true);
});
