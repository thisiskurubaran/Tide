// Renders the extension screens with the store faked, to catch what typechecking can't.
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
// The real one loads fonts through expo-asset, which isn't installed.
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

import { ExtensionsScreen } from '../ExtensionsScreen';
import { extensionsStore } from '../state';

beforeEach(() => extensionsStore.setState({ installed: [] }));

describe('Extensions screen', () => {
  it('lists every extension as free, and installs and removes one', async () => {
    await render(<ExtensionsScreen />);
    expect(screen.getByText('Themes & Icons Pack')).toBeTruthy();
    expect(screen.getByText('Debugger')).toBeTruthy();
    expect(screen.getByTestId('ext-debugger-status')).toHaveTextContent('Free');

    await fireEvent.press(screen.getByTestId('ext-themes-install'));
    expect(extensionsStore.getState().installed).toEqual(['themes']);
    expect(screen.getByTestId('ext-themes-status')).toHaveTextContent('Installed');
    await fireEvent.press(screen.getByTestId('choose-theme'));
    await fireEvent.press(screen.getByTestId('theme-dracula'));
    expect(extensionsStore.getState().prefs.theme).toBe('dracula');
    await fireEvent(screen.getByTestId('file-icons'), 'valueChange', false);
    expect(extensionsStore.getState().prefs.fileIcons).toBe(false);

    await fireEvent.press(screen.getByTestId('ext-themes-remove'));
    expect(extensionsStore.getState().installed).toEqual([]);
    expect(screen.queryByTestId('choose-theme')).toBeNull();
  });

  it('shows Format & Lint settings once installed', async () => {
    extensionsStore.setState({ installed: ['format-lint'] });
    await render(<ExtensionsScreen />);
    await fireEvent(screen.getByTestId('format-on-save'), 'valueChange', true);
    expect(extensionsStore.getState().prefs.formatOnSave).toBe(true);
  });
});
