// "✦ Fix" in the error lens: EditorPane turns it on only with onFixProblem and
// AI set up, and passes taps on.
import { act, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
let mockSent: { type: string; enabled?: boolean }[] = [];
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
let mockReady = true;
jest.mock('../ai/client', () => ({ aiReady: () => mockReady, complete: async () => '' }));
jest.mock('../ai/settings', () => {
  const { createStore } = jest.requireActual('zustand');
  return { aiSettings: createStore(() => ({ completions: false })) };
});
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createStore, useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const buffersStore = createBuffersStore(workspace);
  const settingsStore = createStore(() => ({ theme: 'dark', editorFontSize: 14, wordWrap: true, keymap: 'standard', folding: true, indentGuides: true, minimap: false }));
  return {
    workspace,
    buffersStore,
    settingsStore,
    useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel),
  };
});

import { workspace } from '../../state';
import { EditorPane } from './EditorPane';

const host = { request: async () => null, definition: () => undefined, cursor: () => undefined, save: () => undefined };
const features = { language: true, breakpoints: false, conflicts: false };
const lastAiFix = () => mockSent.filter((m) => m.type === 'setAiFix').pop()?.enabled;

async function mount(onFixProblem?: (path: string, line: number) => void) {
  mockSent = [];
  await render(
    <EditorPane project="p" path="a.ts" features={features} host={host} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} onFixProblem={onFixProblem} />,
  );
  await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } }));
}

beforeAll(async () => {
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', 'a.ts', 'const a: number = "x";\n');
});

beforeEach(() => {
  mockReady = true;
});

it('turns the lens Fix on with onFixProblem and AI ready, and passes taps on', async () => {
  const onFix = jest.fn();
  await mount(onFix);
  expect(lastAiFix()).toBe(true);
  await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'fixProblem', path: 'a.ts', line: 1 }) } }));
  expect(onFix).toHaveBeenCalledWith('a.ts', 1);
});

it('keeps it off without onFixProblem or without AI', async () => {
  await mount();
  expect(lastAiFix()).toBe(false);
  mockReady = false;
  await mount(() => undefined);
  expect(lastAiFix()).toBe(false);
});
