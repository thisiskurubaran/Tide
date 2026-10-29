// Renders the extension screens with the store faked, to catch what typechecking can't.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
// The real one loads fonts through expo-asset, which isn't installed.
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../purchases', () => {
  const actual = jest.requireActual('../purchases');
  return { ...actual, createStorePurchases: () => actual.createFakePurchases({ 'com.thisiskurubaran.tide.ext.themes': '₹249' }) };
});

import { ExtensionsScreen } from '../ExtensionsScreen';
import { extensionsStore } from '../state';

beforeEach(() => extensionsStore.setState({ owned: [], disabled: [], prices: {}, busy: null, error: null }));

describe('Extensions screen', () => {
  it('lists every extension with its store price, and buys one', async () => {
    await render(<ExtensionsScreen />);
    expect(screen.getByText('Themes & Icons Pack')).toBeTruthy();
    expect(screen.getByText('Debugger')).toBeTruthy();
    expect(screen.getByTestId('ext-themes-price')).toHaveTextContent('₹249');
    // No store price yet: the fallback.
    expect(screen.getByTestId('ext-debugger-price')).toHaveTextContent('$9.99');

    await fireEvent.press(screen.getByTestId('ext-themes-buy'));
    expect(extensionsStore.getState().owned).toEqual(['themes']);
    expect(screen.getByText('Installed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('choose-theme'));
    await fireEvent.press(screen.getByTestId('theme-dracula'));
    expect(extensionsStore.getState().prefs.theme).toBe('dracula');
    await fireEvent(screen.getByTestId('file-icons'), 'valueChange', false);
    expect(extensionsStore.getState().prefs.fileIcons).toBe(false);

    await fireEvent(screen.getByTestId('ext-themes-enabled'), 'valueChange', false);
    expect(extensionsStore.getState().disabled).toEqual(['themes']);
    expect(screen.getByText('Turned off')).toBeTruthy();
  });

  it('shows store errors and clears them on tap', async () => {
    await render(<ExtensionsScreen />);
    await act(async () => extensionsStore.setState({ error: 'Payment declined' }));
    await fireEvent.press(screen.getByTestId('extensions-error'));
    expect(extensionsStore.getState().error).toBeNull();
  });

  it('shows Format & Lint settings once owned', async () => {
    extensionsStore.setState({ owned: ['format-lint'] });
    await render(<ExtensionsScreen />);
    await fireEvent(screen.getByTestId('format-on-save'), 'valueChange', true);
    expect(extensionsStore.getState().prefs.formatOnSave).toBe(true);
  });
});
