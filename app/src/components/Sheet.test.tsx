// The iOS sheet: UIKit's form sheet, opened one at a time.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('./haptics', () => ({ haptic: () => undefined }));
jest.mock('../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', contrast: 'standard', haptics: false }));
  return { settingsStore: settings, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});

// A native sheet the test drives by hand: it records what it was told and
// reports appear / disappear only when the test says UIKit finished.
interface Native {
  isOpen: boolean;
  label: string;
  onDidAppear(): void;
  onDidDisappear(): void;
  onNativeDismiss(): void;
}
const mockNatives = new Map<string, Native>();
jest.mock('react-native-screens/experimental', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    FormSheet: (props: Omit<Native, 'label'> & { children: { props: { children: unknown } } }) => {
      // The label is the first Text inside the sheet.
      const find = (node: unknown): string => {
        if (typeof node === 'string') return node;
        if (Array.isArray(node)) return node.map(find).find(Boolean) ?? '';
        if (node && typeof node === 'object' && 'props' in node) return find((node as { props: { children?: unknown } }).props.children);
        return '';
      };
      const label = find(props.children);
      mockNatives.set(label, { ...props, label });
      return props.isOpen ? createElement(View, { testID: `native-${label}` }, props.children) : null;
    },
  };
});

import { ActionSheet } from './ActionSheet';
import { FormSheet } from './FormSheet';
import { Sheet } from './Sheet';
import { SETTLE_MS } from './sheetPresentation';

const native = (label: string) => {
  const n = mockNatives.get(label);
  if (!n) throw new Error(`no native sheet ${label}`);
  return n;
};

beforeEach(() => mockNatives.clear());

it('presents only while visible and maps a swipe-down to onClose', async () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Text onPress={() => setOpen(true)}>open</Text>
        <Sheet visible={open} onClose={() => setOpen(false)}>
          <Text>Body</Text>
        </Sheet>
      </>
    );
  }
  await render(<Host />);
  // Closed sheets don't even mount the native view.
  expect(mockNatives.size).toBe(0);
  await fireEvent.press(screen.getByText('open'));
  expect(native('Body').isOpen).toBe(true);
  expect(screen.getByTestId('native-Body')).toBeTruthy();
  await act(async () => native('Body').onDidAppear());

  await act(async () => native('Body').onNativeDismiss());
  expect(screen.queryByText('Body')).toBeNull();
  // It opens again next time.
  await fireEvent.press(screen.getByText('open'));
  expect(native('Body').isOpen).toBe(true);
});

it('stays closed after a swipe-down even when the caller ignores onClose', async () => {
  const onClose = jest.fn();
  const { rerender } = await render(
    <Sheet visible onClose={onClose}>
      <Text>Sticky</Text>
    </Sheet>,
  );
  await act(async () => native('Sticky').onDidAppear());
  await act(async () => native('Sticky').onNativeDismiss());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Sticky')).toBeNull();
  await rerender(
    <Sheet visible={false} onClose={onClose}>
      <Text>Sticky</Text>
    </Sheet>,
  );
  await rerender(
    <Sheet visible onClose={onClose}>
      <Text>Sticky</Text>
    </Sheet>,
  );
  expect(native('Sticky').isOpen).toBe(true);
});

it('waits for a closing menu to finish before presenting the form it opened', async () => {
  function Host() {
    const [menu, setMenu] = useState<string | null>('Menu');
    const [form, setForm] = useState(false);
    return (
      <>
        <ActionSheet title={menu} actions={[{ label: 'Rename file', icon: 'edit-2', onPress: () => setForm(true) }]} onClose={() => setMenu(null)} />
        <FormSheet visible={form} title="Rename" fields={[{ key: 'name', label: 'Name' }]} confirmLabel="Save" onSubmit={async () => undefined} onClose={() => setForm(false)} />
      </>
    );
  }
  await render(<Host />);
  await act(async () => native('Menu').onDidAppear());
  await fireEvent.press(screen.getByRole('button', { name: 'Rename file' }));
  // The menu (its title gone, so found by its item) is animating out; the
  // form isn't presented yet.
  expect(native('Rename file').isOpen).toBe(false);
  expect(mockNatives.has('Rename')).toBe(false);
  await act(async () => native('Rename file').onDidDisappear());
  expect(native('Rename').isOpen).toBe(true);
  expect(screen.getByTestId('form-name')).toBeTruthy();
});

it('opens anyway if UIKit never reports the end of a transition', async () => {
  jest.useFakeTimers();
  try {
    const { rerender } = await render(
      <>
        <Sheet visible onClose={() => undefined}>
          <Text>First</Text>
        </Sheet>
        <Sheet visible={false} onClose={() => undefined}>
          <Text>Second</Text>
        </Sheet>
      </>,
    );
    await rerender(
      <>
        <Sheet visible={false} onClose={() => undefined}>
          <Text>First</Text>
        </Sheet>
        <Sheet visible onClose={() => undefined}>
          <Text>Second</Text>
        </Sheet>
      </>,
    );
    expect(mockNatives.has('Second')).toBe(false);
    await act(async () => jest.advanceTimersByTime(SETTLE_MS * 2));
    expect(native('Second').isOpen).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it('keeps VoiceOver inside the sheet and closes on the escape gesture', async () => {
  const onClose = jest.fn();
  await render(
    <Sheet visible onClose={onClose} scrollable>
      <Text>Modal</Text>
    </Sheet>,
  );
  const container = screen.getByTestId('native-Modal').children[0] as { props: { accessibilityViewIsModal?: boolean } };
  expect(container.props.accessibilityViewIsModal).toBe(true);
  await fireEvent(screen.getByTestId('native-Modal').children[0] as never, 'accessibilityEscape');
  expect(onClose).toHaveBeenCalled();
});
