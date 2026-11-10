import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { createRef } from 'react';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark' }));
  const runner = createStore((set: (s: object) => void) => ({ mode: 'local', setMode: (mode: string) => set({ mode }) }));
  return {
    useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel),
    useRunner: (sel: (s: unknown) => unknown) => useStore(runner, sel),
  };
});
jest.mock('../remote/useRemoteSession', () => ({ useRemoteSession: () => ({ status: { state: 'off' }, ports: [], retry: () => undefined }) }));

// A stand-in for the WebView terminal that records what reaches each shell.
const mockTyped: Record<string, string[]> = {};
const mockMounted = new Set<string>();
jest.mock('../terminal/TerminalPane', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    TerminalPane: React.forwardRef(function Fake(_props: object, ref: React.Ref<unknown>) {
      const id = React.useId();
      React.useEffect(() => {
        mockMounted.add(id);
        return () => void mockMounted.delete(id);
      }, [id]);
      React.useImperativeHandle(ref, () => ({ input: (d: string) => (mockTyped[id] ??= []).push(d), blur: () => undefined }));
      return React.createElement(Text, null, `pane ${id}`);
    }),
  };
});

import { TerminalPanel, TerminalPanelHandle } from './TerminalPanel';


it('keeps every terminal running and sends input to the one showing', async () => {
  const ref = createRef<TerminalPanelHandle>();
  await render(<TerminalPanel ref={ref} project="p" onFocusChange={() => undefined} onShortcut={() => undefined} />);
  expect(mockMounted.size).toBe(1);
  await fireEvent.press(screen.getByTestId('terminal-new'));
  await act(async () => ref.current!.newTerminal());
  expect(mockMounted.size).toBe(3);
  await act(async () => ref.current!.input('third'));
  await fireEvent.press(screen.getByTestId('terminal-tab-1'));
  await act(async () => ref.current!.input('first'));
  expect(Object.values(mockTyped).map((v) => v.join())).toEqual(['third', 'first']);

  // VoiceOver: the close button is its own element, beside the tab rather than inside it.
  expect(screen.getByRole('button', { name: 'Close terminal 1' })).toBeTruthy();
  expect(within(screen.getByTestId('terminal-tab-1')).queryByTestId('terminal-close-1')).toBeNull();

  // Closing one only stops that shell.
  await fireEvent.press(screen.getByTestId('terminal-close-1'));
  expect(mockMounted.size).toBe(2);
  expect(screen.getByTestId('terminal-tab-2')).toBeTruthy();
  expect(screen.queryByTestId('terminal-tab-3')).toBeNull();
});
