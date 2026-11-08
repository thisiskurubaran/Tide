// The tab row, as VoiceOver and TalkBack see it.
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../extensions/themes', () => ({ FileIcon: ({ fallback }: { fallback: unknown }) => fallback }));
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', contrast: 'normal', haptics: false }));
  return { settingsStore: settings, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});

import { TabBar } from './TabBar';

it('announces unsaved changes and offers Close as an action of the tab', async () => {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  await render(<TabBar open={['src/a.ts', 'b.ts']} active="src/a.ts" dirty={new Set(['b.ts'])} onSelect={onSelect} onClose={onClose} />);
  const tab = screen.getByTestId('tab-b.ts');
  expect(tab.props.accessibilityLabel).toBe('b.ts, unsaved changes');
  expect(screen.getByTestId('tab-src/a.ts').props.accessibilityLabel).toBe('a.ts');
  expect(tab.props.accessibilityActions).toEqual([{ name: 'activate' }, { name: 'close', label: 'Close b.ts' }]);
  await fireEvent(tab, 'accessibilityAction', { nativeEvent: { actionName: 'close' } });
  expect(onClose).toHaveBeenCalledWith('b.ts');
  await fireEvent(tab, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  expect(onSelect).toHaveBeenCalledWith('b.ts');
  // The visible button still closes on a tap.
  await fireEvent.press(screen.getByTestId('close-src/a.ts'));
  expect(onClose).toHaveBeenCalledWith('src/a.ts');
});

it('shows pinned tabs with a pin, narrow on phones, and offers pinning as an action and in the menu', async () => {
  const onPin = jest.fn();
  const onUnpin = jest.fn();
  const onCloseOthers = jest.fn();
  const onReveal = jest.fn();
  const props = { dirty: new Set(['src/p.ts']), onSelect: jest.fn(), onClose: jest.fn(), onPin, onUnpin, onCloseOthers, onReveal };
  await render(<TabBar {...props} open={['src/p.ts', 'a.ts', 'b.ts']} active="src/p.ts" pinned={['src/p.ts']} compact />);
  const pinned = screen.getByTestId('tab-src/p.ts');
  expect(pinned.props.accessibilityLabel).toBe('p.ts, pinned, unsaved changes');
  expect(screen.getByTestId('pin-src/p.ts')).toBeTruthy();
  expect(screen.queryByTestId('pin-a.ts')).toBeNull();
  // On a phone a pinned tab has no close button and no folder, but keeps its unsaved dot.
  expect(screen.queryByTestId('close-src/p.ts')).toBeNull();
  expect(screen.getByTestId('dirty-src/p.ts')).toBeTruthy();
  expect(screen.queryByText('src/')).toBeNull();
  expect(screen.getByTestId('close-a.ts')).toBeTruthy();
  expect(pinned.props.accessibilityActions).toEqual([
    { name: 'activate' },
    { name: 'close', label: 'Close p.ts' },
    { name: 'unpin', label: 'Unpin p.ts' },
    { name: 'closeOthers', label: 'Close other tabs' },
  ]);
  await fireEvent(pinned, 'accessibilityAction', { nativeEvent: { actionName: 'unpin' } });
  expect(onUnpin).toHaveBeenCalledWith('src/p.ts');
  await fireEvent(screen.getByTestId('tab-a.ts'), 'accessibilityAction', { nativeEvent: { actionName: 'pin' } });
  expect(onPin).toHaveBeenCalledWith('a.ts');
  await fireEvent(screen.getByTestId('tab-a.ts'), 'accessibilityAction', { nativeEvent: { actionName: 'closeOthers' } });
  expect(onCloseOthers).toHaveBeenCalledWith('a.ts');

  // The long-press menu.
  await fireEvent(screen.getByTestId('tab-b.ts'), 'longPress');
  expect(screen.getByText('Close other tabs')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pin tab'));
  expect(onPin).toHaveBeenCalledWith('b.ts');
  await fireEvent(screen.getByTestId('tab-src/p.ts'), 'longPress');
  await fireEvent.press(screen.getByText('Reveal in file tree'));
  expect(onReveal).toHaveBeenCalledWith('src/p.ts');
  await fireEvent(screen.getByTestId('tab-src/p.ts'), 'longPress');
  await fireEvent.press(screen.getByText('Unpin tab'));
  expect(onUnpin).toHaveBeenCalledTimes(2);
});

it('keeps the close button on pinned tabs on wider screens', async () => {
  await render(<TabBar open={['a.ts', 'b.ts']} active="b.ts" dirty={new Set()} pinned={['a.ts']} onSelect={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByTestId('close-a.ts')).toBeTruthy();
  expect(screen.getByTestId('pin-a.ts')).toBeTruthy();
});
