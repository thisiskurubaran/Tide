// AI inline completions: the editor's request goes to complete() and the
// answer comes back as a 'completion', with the WebView replaced by a recorder.
import { act, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
let mockSent: Record<string, unknown>[] = [];
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
  const settingsStore = createStore(() => ({ theme: 'dark', editorFontSize: 14, wordWrap: true, keymap: 'standard', folding: true, indentGuides: true, minimap: false }));
  return {
    workspace,
    buffersStore,
    settingsStore,
    useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel),
  };
});
const mockComplete = jest.fn();
let mockReady = true;
jest.mock('../ai/client', () => ({ complete: (req: unknown) => mockComplete(req), aiReady: () => mockReady }));
jest.mock('../ai/settings', () => {
  const { createStore } = jest.requireActual('zustand');
  return { aiSettings: createStore(() => ({ model: 'claude-haiku-5-5', completions: true })) };
});

import { workspace } from '../../state';
import { aiSettings } from '../ai/settings';
import { EditorPane } from './EditorPane';

const host = { request: async () => null, definition: () => undefined, cursor: () => undefined, save: () => undefined };
const features = { language: true, breakpoints: false, conflicts: false };
const fromEditor = (msg: object) => act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify(msg) } }));
const request = (requestId: number, prefix = 'const a = ') => ({ type: 'requestCompletion', requestId, path: 'small.ts', prefix, suffix: '\n' });
const lastSetting = () => mockSent.filter((m) => m.type === 'setCompletions').pop();

async function openFile(onCompletionState = jest.fn()) {
  mockSent = [];
  await render(
    <EditorPane
      project="p"
      path="small.ts"
      features={features}
      host={host}
      onBrowse={() => undefined}
      onShortcut={() => undefined}
      onFocusChange={() => undefined}
      onCompletionState={onCompletionState}
    />,
  );
  await fromEditor({ type: 'ready' });
  return onCompletionState;
}

beforeAll(async () => {
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', 'small.ts', 'const a = 1;\n');
});
beforeEach(() => {
  mockComplete.mockReset();
  mockReady = true;
  aiSettings.setState({ completions: true } as never);
});

it('answers a request with complete() and sends the completion back', async () => {
  mockComplete.mockResolvedValue('42;');
  await openFile();
  expect(lastSetting()).toEqual({ type: 'setCompletions', enabled: true, model: 'claude-haiku-5-5' });
  await fromEditor(request(7));
  expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ path: 'small.ts', language: 'typescript', prefix: 'const a = ', suffix: '\n' }));
  expect(mockSent.filter((m) => m.type === 'completion')).toEqual([{ type: 'completion', requestId: 7, text: '42;' }]);
});

it('aborts the previous request and drops its answer', async () => {
  const resolvers: ((text: string) => void)[] = [];
  mockComplete.mockImplementation(() => new Promise<string>((resolve) => resolvers.push(resolve)));
  await openFile();
  await fromEditor(request(1));
  await fromEditor(request(2));
  const first = mockComplete.mock.calls[0][0] as { signal: AbortSignal };
  expect(first.signal.aborted).toBe(true);
  await act(async () => {
    resolvers[0]('old');
    resolvers[1]('new');
  });
  expect(mockSent.filter((m) => m.type === 'completion')).toEqual([{ type: 'completion', requestId: 2, text: 'new' }]);
});

it('answers errors with nothing, without alerting', async () => {
  mockComplete.mockRejectedValue(Object.assign(new Error('Spend limit reached'), { kind: 'limit' }));
  await openFile();
  await fromEditor(request(3));
  expect(mockSent.filter((m) => m.type === 'completion')).toEqual([{ type: 'completion', requestId: 3, text: '' }]);
});

it('is off without a ready provider or with the setting off', async () => {
  mockReady = false;
  await openFile();
  expect(lastSetting()).toEqual({ type: 'setCompletions', enabled: false, model: 'claude-haiku-5-5' });
  await fromEditor(request(4));
  expect(mockComplete).not.toHaveBeenCalled();

  mockReady = true;
  await openFile();
  expect(lastSetting()).toMatchObject({ enabled: true });
  await act(async () => aiSettings.setState({ completions: false } as never));
  expect(lastSetting()).toMatchObject({ enabled: false });
});

it('reports when ghost text shows', async () => {
  const onState = await openFile();
  await fromEditor({ type: 'completionState', visible: true });
  await fromEditor({ type: 'completionState', visible: false });
  expect(onState.mock.calls).toEqual([[true], [false]]);
});
