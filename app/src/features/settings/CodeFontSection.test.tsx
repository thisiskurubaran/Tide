import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createFsStorage } = jest.requireActual('../../state/storage');
  const { createSettingsStore } = jest.requireActual('../../state/settings');
  const { useStore } = jest.requireActual('zustand');
  const settingsStore = createSettingsStore(createFsStorage(createMemoryFs()));
  return { settingsStore, useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel) };
});

import { settingsStore } from '../../state';
import { CodeFontSection } from './CodeFontSection';

it('lists the fonts with JetBrains Mono selected, and saves a pick and the ligature switch', async () => {
  await render(<CodeFontSection />);
  expect(screen.getByTestId('code-font-jetbrains-mono').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByText('Default')).toBeTruthy();
  expect(screen.getAllByText('const ok = (a, b) => a !== b && a >= 0;')).toHaveLength(4);

  await act(async () => fireEvent.press(screen.getByTestId('code-font-fira-code')));
  expect(settingsStore.getState().codeFont).toBe('fira-code');
  expect(screen.getByTestId('code-font-fira-code').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByTestId('code-font-jetbrains-mono').props.accessibilityState).toMatchObject({ selected: false });

  await act(async () => fireEvent(screen.getByTestId('code-font-ligatures'), 'valueChange', true));
  expect(settingsStore.getState().ligatures).toBe(true);
});
