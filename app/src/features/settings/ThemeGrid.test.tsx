import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';

jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createFsStorage } = jest.requireActual('../../state/storage');
  const { createSettingsStore } = jest.requireActual('../../state/settings');
  const { useStore } = jest.requireActual('zustand');
  const storage = createFsStorage(createMemoryFs());
  const settingsStore = createSettingsStore(storage);
  return { storage, settingsStore, useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel) };
});

import { extensionsStore } from '../../extensions/state';
import { settingsStore } from '../../state';
import { useColorScheme, useColors } from '../../theme/theme';
import { palette } from '../../theme/tokens';
import { ThemeGrid } from './ThemeGrid';

it('offers only Tide until Themes & Icons is installed, then every theme, and the app follows the pick', async () => {
  await render(<ThemeGrid />);
  expect(screen.getByTestId('theme-tile-tide').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.queryByTestId('theme-tile-dracula')).toBeNull();

  await act(async () => fireEvent.press(screen.getByTestId('theme-install')));
  expect(extensionsStore.getState().installed).toContain('themes');
  expect(screen.queryByTestId('theme-install')).toBeNull();

  await act(async () => fireEvent.press(screen.getByTestId('theme-tile-solarized-light')));
  expect(extensionsStore.getState().prefs.theme).toBe('solarized-light');
  expect(screen.getByTestId('theme-tile-solarized-light').props.accessibilityState).toMatchObject({ selected: true });

  // A light theme makes the whole app light, with colors from the theme.
  const app = await renderHook(() => ({ scheme: useColorScheme(), colors: useColors() }));
  expect(app.result.current.scheme).toBe('light');
  expect(app.result.current.colors.background).toBe('#fdf6e3');

  // Turning matchChrome off goes back to Tide's palette.
  await act(async () => settingsStore.getState().setMatchChrome(false));
  app.rerender({});
  expect(app.result.current.scheme).toBe('dark');
  expect(app.result.current.colors).toBe(palette.dark);
});
