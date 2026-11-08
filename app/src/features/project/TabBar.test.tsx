// The tab row, as VoiceOver and TalkBack see it.
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('../../extensions/themes', () => ({ FileIcon: ({ fallback }: { fallback: unknown }) => fallback }));
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', contrast: 'normal' }));
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
