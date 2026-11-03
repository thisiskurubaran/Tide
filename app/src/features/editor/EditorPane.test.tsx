// Large and binary files, with the WebView replaced by a recorder of the
// messages the pane sends it.
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
let mockSent: { type: string; language?: string; options?: Record<string, boolean>; features?: Record<string, boolean>; font?: string; ligatures?: boolean }[] = [];
let mockOnMessage: (e: { nativeEvent: { data: string } }) => void = () => undefined;
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(function FakeWebView(props: { onMessage: typeof mockOnMessage }, ref: React.Ref<unknown>) {
      mockOnMessage = props.onMessage;
      React.useImperativeHandle(ref, () => ({
        injectJavaScript: (js: string) => {
          const m = /receive\((.*)\);true;$/.exec(js);
          if (m) mockSent.push(JSON.parse(JSON.parse(m[1])));
        },
        reload: () => undefined,
      }));
      return React.createElement(View);
    }),
  };
});
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createStore, useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const buffersStore = createBuffersStore(workspace);
  const settingsStore = createStore(() => ({
    theme: 'dark',
    editorFontSize: 14,
    wordWrap: true,
    keymap: 'standard',
    folding: true,
    indentGuides: true,
    minimap: false,
    setEditorFontSize: () => undefined,
  }));
  return {
    workspace,
    buffersStore,
    settingsStore,
    useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel),
  };
});

import { settingsStore, workspace } from '../../state';
import { NO_FEATURES } from './bridge';
import { EditorPane } from './EditorPane';
import { LARGE_CHARS } from './largeFiles';

const host = { request: async () => null, definition: () => undefined, cursor: () => undefined, save: () => undefined };
const features = { language: true, breakpoints: false, conflicts: false };

async function openFile(path: string) {
  mockSent = [];
  await render(
    <EditorPane project="p" path={path} features={features} host={host} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} />,
  );
  await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } }));
}

beforeAll(async () => {
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', 'small.ts', 'const a = 1;\n');
  await workspace.createFile('p', '', 'big.ts', 'x'.repeat(LARGE_CHARS + 10));
  await workspace.createFile('p', '', 'image.png', 'PNG\u0000\u0001\u0002');
});

it('opens normal files with their language', async () => {
  await openFile('small.ts');
  expect(mockSent.find((m) => m.type === 'open')?.language).toBe('typescript');
  expect(screen.queryByText(/Large file/)).toBeNull();
});

it('opens large files as plain text with the extras off', async () => {
  await openFile('big.ts');
  expect(mockSent.find((m) => m.type === 'open')?.language).toBe('plain');
  expect(mockSent.filter((m) => m.type === 'options').pop()?.options).toEqual({ wordWrap: false, folding: false, indentGuides: false, minimap: false, keymap: 'standard' });
  expect(mockSent.filter((m) => m.type === 'features').pop()?.features).toEqual(NO_FEATURES);
  expect(screen.getByText(/Large file/)).toBeTruthy();
});

it('sends the code font on load and when it changes', async () => {
  await openFile('small.ts');
  // The mocked settings have no codeFont, like settings saved before the option existed.
  expect(mockSent.find((m) => m.type === 'setFont')).toEqual({ type: 'setFont', font: 'jetbrains-mono', ligatures: false });
  await act(async () => settingsStore.setState({ codeFont: 'fira-code', ligatures: true } as never));
  expect(mockSent.filter((m) => m.type === 'setFont').pop()).toEqual({ type: 'setFont', font: 'fira-code', ligatures: true });
  await act(async () => settingsStore.setState({ codeFont: undefined, ligatures: undefined } as never));
});

it("doesn't open binary files", async () => {
  await openFile('image.png');
  expect(mockSent.find((m) => m.type === 'open')).toBeUndefined();
  expect(screen.getByTestId('editor-refused')).toBeTruthy();
});
