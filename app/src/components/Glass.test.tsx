// Liquid Glass bars and their solid fallback; the activity bar labels (#19).
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', contrast: 'standard', haptics: false }));
  return { settingsStore: settings, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});

// Catch the Reduce Transparency listener the a11y store registers.
const listeners: Record<string, (value: boolean) => void> = {};
jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((event: string, handler: (value: boolean) => void) => {
  listeners[event] = handler;
  return { remove: () => undefined };
}) as never);

import { ActivityBar } from '../features/project/ActivityBar';
import { settingsStore } from '../state';
import { GlassSurface, withAlpha } from './Glass';

afterEach(async () => {
  await act(async () => listeners.reduceTransparencyChanged?.(false));
  settingsStore.setState({ contrast: 'standard' });
});

it('puts glass behind the content, and the solid colour back with Reduce Transparency', async () => {
  await render(
    <GlassSurface color="#122027" testID="bar">
      <Text>Title</Text>
    </GlassSurface>,
  );
  expect(screen.getByTestId('glass-background')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('bar').props.style).backgroundColor).toBe('transparent');
  expect(screen.getByText('Title')).toBeTruthy();

  await act(async () => listeners.reduceTransparencyChanged(true));
  expect(screen.queryByTestId('glass-background')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('bar').props.style).backgroundColor).toBe('#122027');
});

it('stays solid in high contrast', async () => {
  settingsStore.setState({ contrast: 'high' });
  await render(<GlassSurface color="#000000" testID="bar" />);
  expect(screen.queryByTestId('glass-background')).toBeNull();
});

it('tints with the theme colour at partial opacity', () => {
  expect(withAlpha('#122027', 0.5)).toBe('#12202780');
  expect(withAlpha('#fff', 1)).toBe('#ffffffff');
  expect(withAlpha('#11223344', 0)).toBe('#11223300');
  expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)');
});

it('lets activity bar labels follow Dynamic Type at 11pt or more', async () => {
  await render(<ActivityBar items={[{ id: 'git', label: 'Source Control', icon: 'git-branch', badge: 3 }]} active="git" onSelect={() => undefined} />);
  const label = screen.getByText('Source Control');
  expect(label.props.maxFontSizeMultiplier).toBeUndefined();
  expect(label.props.allowFontScaling).not.toBe(false);
  expect(label.props.numberOfLines).toBe(2);
  expect(StyleSheet.flatten(label.props.style).fontSize).toBeGreaterThanOrEqual(11);
  expect(StyleSheet.flatten(screen.getByText('3').props.style).fontSize).toBeGreaterThanOrEqual(11);
  expect(screen.getByTestId('glass-background')).toBeTruthy();
});
