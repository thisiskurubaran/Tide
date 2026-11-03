import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => 'pasted'), setStringAsync: jest.fn(async () => true) }));
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark' }));
  return {
    storage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
    useSettings: (selector: (s: unknown) => unknown) => useStore(settings, selector),
  };
});

import { EditorKeyBar } from '../editor/EditorKeyBar';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { DEFAULT_EDITOR_KEYS, keyFace, LANGUAGE_PRESETS, terminalData, text } from './catalog';
import { KeyBarSettingsScreen } from './KeyBarSettingsScreen';
import { editorKeys, keyBarStore } from './store';

beforeEach(() => keyBarStore.setState({ editor: {}, terminal: keyBarStore.getInitialState().terminal }));

// Editor keys read raw touches (to tell taps, swipes and holds apart), so tests touch them directly.
let clock = 0;
const touch = (x: number, y = 500) => ({ nativeEvent: { pageX: x, pageY: y, locationX: 10, locationY: 10, timestamp: (clock += 100) } });
async function tap(label: string) {
  const key = screen.getByLabelText(label);
  await fireEvent(key, 'responderGrant', touch(100));
  await fireEvent(key, 'responderRelease', touch(100));
}

describe('catalog', () => {
  it('describes built-in and text keys', () => {
    expect(keyFace('left', 'editor')).toMatchObject({ icon: 'arrow-left', a11y: 'Cursor left' });
    expect(keyFace(text('{'), 'editor')).toMatchObject({ label: '{', a11y: 'Open brace' });
    expect(keyFace(text('console.log('), 'editor')).toMatchObject({ label: 'console…', a11y: 'Type console.log(' });
    expect(keyFace('no-such-key', 'terminal')).toBeNull();
    expect(terminalData('ctrl-c')).toBe('\x03');
    expect(terminalData(text('ls -la'))).toBe('ls -la');
  });

  it('falls back from a language to the default list', () => {
    expect(editorKeys({ editor: {} }, 'python')).toEqual(DEFAULT_EDITOR_KEYS);
    expect(editorKeys({ editor: { default: ['tab'] } }, 'python')).toEqual(['tab']);
    expect(editorKeys({ editor: { default: ['tab'], python: ['undo'] } }, 'python')).toEqual(['undo']);
  });
});

describe('key bars', () => {
  it('sends what each configured key means', async () => {
    keyBarStore.getState().setEditor('python', ['tab', text('self.'), 'complete']);
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="python" />);
    await tap('Tab');
    await tap('Type self.');
    await tap('Show suggestions');
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ type: 'key', key: 'tab', select: false }, { type: 'insert', text: 'self.' }, { type: 'complete' }]);
  });

  it('types terminal keys as bytes', async () => {
    keyBarStore.getState().setTerminal(['ctrl-d', text('git status\r')]);
    const input = jest.fn();
    await render(<TerminalKeyBar input={input} onHide={() => undefined} />);
    await fireEvent.press(screen.getByLabelText('Control D'));
    await fireEvent.press(screen.getByLabelText('Type git status\r'));
    expect(input.mock.calls.map((c) => c[0])).toEqual(['\x04', 'git status\r']);
  });
});

describe('touch editing keys', () => {
  it('moves the cursor from the trackpad, extending the selection in select mode', async () => {
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="plain" />);
    const pad = screen.getByTestId('editor-trackpad');
    await fireEvent(pad, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await tap('Select mode');
    expect(screen.getByLabelText('Select mode').props.accessibilityState).toEqual({ selected: true });
    await fireEvent(pad, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await tap('Cursor up');
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'key', key: 'right', select: false },
      { type: 'key', key: 'left', select: true },
      { type: 'key', key: 'up', select: true },
    ]);
  });

  it('copies, expands and pastes through the system clipboard', async () => {
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="plain" />);
    await tap('Expand selection');
    await tap('Copy');
    await tap('Paste');
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'select', unit: 'expand' },
      { type: 'copy', cut: false },
      { type: 'insert', text: 'pasted' },
    ]);
  });

  it('moves the cursor when a drag across the keys passes the slop, without typing the key', async () => {
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="plain" />);
    const key = screen.getByLabelText('Open brace');
    await fireEvent(key, 'responderGrant', touch(100));
    await fireEvent(key, 'responderMove', touch(108));
    await fireEvent(key, 'responderMove', touch(115));
    await fireEvent(key, 'responderMove', touch(133));
    await fireEvent(key, 'responderMove', touch(115));
    await fireEvent(key, 'responderRelease', touch(115));
    await tap('Select mode');
    await fireEvent(key, 'responderGrant', touch(100));
    await fireEvent(key, 'responderMove', touch(80));
    await fireEvent(key, 'responderMove', touch(62));
    await fireEvent(key, 'responderRelease', touch(62));
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'moveCursor', by: 2, select: false },
      { type: 'moveCursor', by: -2, select: false },
      { type: 'moveCursor', by: -2, select: true },
    ]);
  });

  it('pages the keys, since dragging them moves the cursor', async () => {
    await render(<EditorKeyBar send={() => undefined} language="plain" />);
    const row = screen.getByTestId('keyboard-bar-keys');
    expect(row.props.scrollEnabled).toBe(false);
    await fireEvent(row, 'layout', { nativeEvent: { layout: { width: 300 } } });
    await fireEvent(row, 'contentSizeChange', 1000, 32);
    expect(screen.getByLabelText('More keys')).toBeTruthy();
  });

  it('turns terminal trackpad moves into arrow keys and pastes', async () => {
    const input = jest.fn();
    await render(<TerminalKeyBar input={input} onHide={() => undefined} />);
    await fireEvent(screen.getByTestId('terminal-trackpad'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await fireEvent.press(screen.getByLabelText('Paste'));
    expect(input.mock.calls.map((c) => c[0])).toEqual(['\x1b[D', 'pasted']);
  });
});

describe('key variants', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const hold = async (label: string) => {
    const key = screen.getByLabelText(label);
    await fireEvent(key, 'responderGrant', touch(100));
    await act(() => jest.advanceTimersByTime(400));
    return key;
  };

  it('inserts the variant the finger is released on, caret inside a pair', async () => {
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="plain" />);
    const key = await hold('Open parenthesis');
    // With no layout in tests the popover sits at the bar's left edge: cells () ( ) => from x=7.
    expect(screen.getByText('=>')).toBeTruthy();
    await fireEvent(key, 'responderMove', touch(20, 460));
    await fireEvent(key, 'responderRelease', touch(20, 460));
    expect(screen.queryByText('=>')).toBeNull();
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ type: 'insertLiteral', text: '()', cursor: 1 }]);
  });

  it('cancels when released away from the popover', async () => {
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="plain" />);
    const key = await hold('Equals');
    await fireEvent(key, 'responderMove', touch(100, 300));
    await fireEvent(key, 'responderRelease', touch(100, 300));
    expect(send).not.toHaveBeenCalled();
  });

  it('offers variants as accessibility actions', async () => {
    const send = jest.fn();
    await render(<EditorKeyBar send={send} language="plain" />);
    const key = screen.getByLabelText('Slash');
    expect(key.props.accessibilityActions.map((a: { label?: string }) => a.label)).toEqual([undefined, 'Line comment', 'Block comment', 'Backslash']);
    await fireEvent(key, 'accessibilityAction', { nativeEvent: { actionName: 'variant-1' } });
    await fireEvent(key, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'insertLiteral', text: '/*  */', cursor: 3 },
      { type: 'insert', text: '/' },
    ]);
  });
});

describe('Key bar settings', () => {
  it('gives a language its own keys, edits them and resets', async () => {
    await render(<KeyBarSettingsScreen />);
    await fireEvent.press(screen.getByTestId('keybar-layout-python'));
    expect(screen.getByText(/Uses the keys for all files/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('keybar-preset'));
    expect(keyBarStore.getState().editor.python).toEqual(LANGUAGE_PRESETS.python);

    await fireEvent.press(screen.getByTestId('keybar-remove-0'));
    expect(keyBarStore.getState().editor.python![0]).toBe('select');
    await fireEvent.press(screen.getByTestId('keybar-down-0'));
    expect(keyBarStore.getState().editor.python!.slice(0, 2)).toEqual(['left', 'select']);

    await fireEvent.press(screen.getByTestId('keybar-add-text'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. => or self.'), 'print(');
    await fireEvent.press(screen.getByText('Add'));
    expect(keyBarStore.getState().editor.python!.at(-1)).toBe(text('print('));

    await fireEvent.press(screen.getByTestId('keybar-reset'));
    expect(keyBarStore.getState().editor.python).toBeUndefined();
    // The default list wasn't touched.
    expect(keyBarStore.getState().editor.default).toBeUndefined();
  });

  it('edits the terminal keys', async () => {
    await render(<KeyBarSettingsScreen />);
    await fireEvent.press(screen.getByTestId('keybar-target-terminal'));
    await fireEvent.press(screen.getByTestId('keybar-add'));
    await fireEvent.press(screen.getByText('Control D'));
    expect(keyBarStore.getState().terminal.at(-1)).toBe('ctrl-d');
  });
});
