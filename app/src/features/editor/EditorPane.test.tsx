// Large and binary files, with the WebView replaced by a recorder of the
// messages the pane sends it.
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
let mockScreenReader = false;
jest.mock('../../components/a11y', () => ({ ...jest.requireActual('../../components/a11y'), useScreenReader: () => mockScreenReader }));
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
  const projectsStore = createStore(() => ({ loadTree: jest.fn(async () => undefined) }));
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
    projectsStore,
    settingsStore,
    useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel),
  };
});

import { buffersStore, projectsStore, settingsStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { ALL_GESTURES, NO_FEATURES, NO_GESTURES } from './bridge';
import { EditorHandle, EditorPane, FLUSH_TIMEOUT_MS } from './EditorPane';
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

describe('gestures', () => {
  const gestures = () => (mockSent.filter((m) => m.type === 'setGestures').pop() as { gestures?: unknown } | undefined)?.gestures;

  it('sends the gesture settings, all on by default', async () => {
    await openFile('small.ts');
    expect(gestures()).toEqual(ALL_GESTURES);
    await act(async () => settingsStore.setState({ gestures: { ...ALL_GESTURES, pinch: false } } as never));
    expect(gestures()).toEqual({ ...ALL_GESTURES, pinch: false });
    await act(async () => settingsStore.setState({ gestures: undefined } as never));
  });

  it('turns every gesture off while a screen reader runs', async () => {
    mockScreenReader = true;
    try {
      await openFile('small.ts');
      expect(gestures()).toEqual(NO_GESTURES);
    } finally {
      mockScreenReader = false;
    }
  });

  it('shows the editor actions on a two-finger tap', async () => {
    const onActions = jest.fn();
    mockSent = [];
    await render(
      <EditorPane project="p" path="small.ts" features={features} host={host} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} onActions={onActions} />,
    );
    await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'actions' }) } }));
    expect(onActions).toHaveBeenCalledTimes(1);
  });
});

it('answers a peek from the editor and follows Open', async () => {
  const target = { path: 'small.ts', line: 1, text: 'const a = 1;', startLine: 1 };
  const peek = jest.fn(async () => target);
  const openAt = jest.fn();
  mockSent = [];
  await render(
    <EditorPane project="p" path="small.ts" features={features} host={{ ...host, peek, openAt }} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} />,
  );
  await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } }));
  await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'peek', path: 'small.ts', offset: 6 }) } }));
  expect(peek).toHaveBeenCalledWith('small.ts', 6);
  expect(mockSent.find((m) => m.type === 'showPeek')).toEqual({ type: 'showPeek', path: 'small.ts', offset: 6, target });
  await act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify({ type: 'openAt', path: 'other.ts', line: 3 }) } }));
  expect(openAt).toHaveBeenCalledWith('other.ts', 3);
});

it('moves between problems from the accessibility actions', async () => {
  await openFile('small.ts');
  const container = screen.getByTestId('editor-pane');
  expect(container.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Next problem', 'Previous problem']);
  await act(async () => container.props.onAccessibilityAction({ nativeEvent: { actionName: 'previousProblem' } }));
  expect(mockSent.pop()).toEqual({ type: 'gotoProblem', direction: -1 });
});

describe('flush', () => {
  const message = (msg: object) => act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify(msg) } }));

  async function openWithRef(path: string) {
    const ref = createRef<EditorHandle>();
    mockSent = [];
    await render(
      <EditorPane ref={ref} project="p" path={path} features={features} host={host} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} />,
    );
    await message({ type: 'ready' });
    return ref;
  }

  it('waits for the editor to send its pending typing before resolving', async () => {
    await workspace.createFile('p', '', 'flush.ts', 'start');
    const ref = await openWithRef('flush.ts');
    let done = false;
    const flushed = ref.current!.flush().then(() => (done = true));
    const request = mockSent.filter((m) => m.type === 'flush').pop() as unknown as { id: number };
    expect(request).toBeDefined();
    await act(async () => undefined);
    expect(done).toBe(false);
    // The editor answers in order: its last change, then flushed.
    await message({ type: 'change', path: 'flush.ts', content: 'start typed' });
    await message({ type: 'flushed', id: request.id });
    await flushed;
    expect(buffersStore.getState().buffers[bufferKey('p', 'flush.ts')].content).toBe('start typed');
  });

  it("doesn't wait forever for an editor that doesn't answer", async () => {
    const ref = await openWithRef('small.ts');
    jest.useFakeTimers();
    try {
      const flushed = ref.current!.flush();
      jest.advanceTimersByTime(FLUSH_TIMEOUT_MS);
      await expect(flushed).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

it('says when the open file was deleted on disk with unsaved edits, and can save it again', async () => {
  await workspace.createFile('p', '', 'doomed.ts', 'one');
  await openFile('doomed.ts');
  await act(async () => {
    buffersStore.getState().edit('p', 'doomed.ts', 'two');
    await workspace.deleteEntry('p', 'doomed.ts');
    await buffersStore.getState().reload('p', 'doomed.ts');
  });
  expect(screen.getByTestId('editor-deleted')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('Save as new file'));
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(await workspace.readFile('p', 'doomed.ts')).toBe('two');
  expect(screen.queryByTestId('editor-deleted')).toBeNull();
  // The file is back in the tree.
  expect(projectsStore.getState().loadTree).toHaveBeenCalledWith('p');
});

describe('a tab with no editable file', () => {
  const message = (msg: object) => act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify(msg) } }));
  const pane = (path: string | null) => (
    <EditorPane project="p" path={path} features={features} host={host} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} />
  );
  const content = (path: string) => buffersStore.getState().buffers[bufferKey('p', path)]?.content;

  // Answers the flush the pane sent after closing the document, as the editor would.
  const answerFlush = async () => {
    const flush = mockSent.filter((m) => m.type === 'flush').pop() as unknown as { id: number };
    await message({ type: 'flushed', id: flush.id });
  };

  it("shows an error for a file that can't be opened, and never lets typing land in the previous file (H1)", async () => {
    await workspace.createFile('p', '', 'a.ts', 'file a');
    mockSent = [];
    const view = await render(pane('a.ts'));
    await message({ type: 'ready' });
    mockSent = [];
    await act(async () => view.rerender(pane('missing.ts')));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByTestId('editor-refused')).toBeTruthy();
    expect(screen.getByText(/Couldn't open missing\.ts/)).toBeTruthy();
    expect(mockSent.some((m) => m.type === 'close')).toBe(true);
    // What the editor still held for a.ts when it closed arrives first, and is kept...
    await message({ type: 'change', path: 'a.ts', content: 'file a, typed before' });
    await answerFlush();
    expect(content('a.ts')).toBe('file a, typed before');
    // ...but nothing after that writes into a.ts while missing.ts is selected.
    await message({ type: 'change', path: 'a.ts', content: 'typed while missing.ts was selected' });
    expect(content('a.ts')).toBe('file a, typed before');
    await act(async () => new Promise((r) => setTimeout(r, 1000)));
    expect(await workspace.readFile('p', 'a.ts')).toBe('file a, typed before');
  });

  it('ignores changes for a file the editor is not showing', async () => {
    await workspace.createFile('p', '', 'shown.ts', 'shown');
    await workspace.createFile('p', '', 'other.ts', 'other');
    await buffersStore.getState().load('p', 'other.ts');
    await openFile('shown.ts');
    await message({ type: 'change', path: 'other.ts', content: 'stray' });
    expect(content('other.ts')).toBe('other');
  });

  it('closes the document for a viewer (no path), a binary and a too-large file (M3)', async () => {
    await openFile('small.ts');
    mockSent = [];
    await act(async () => screen.rerender(pane(null)));
    expect(mockSent.some((m) => m.type === 'close')).toBe(true);
    await openFile('image.png');
    expect(mockSent.some((m) => m.type === 'close')).toBe(true);
    const size = jest.spyOn(workspace, 'fileSize').mockResolvedValueOnce(100 * 1024 * 1024);
    await workspace.createFile('p', '', 'huge.log', 'x');
    await openFile('huge.log');
    size.mockRestore();
    expect(screen.getByText(/too big to edit here/)).toBeTruthy();
    expect(mockSent.some((m) => m.type === 'close')).toBe(true);
    expect(mockSent.find((m) => m.type === 'open')).toBeUndefined();
  });

  it('says where unsaved edits went when a new file took the path', async () => {
    await workspace.createFile('p', '', 'taken.ts', 'one');
    await openFile('taken.ts');
    await act(async () => {
      buffersStore.getState().edit('p', 'taken.ts', 'my edits');
      await workspace.deleteEntry('p', 'taken.ts');
      await buffersStore.getState().reload('p', 'taken.ts');
      await workspace.createFile('p', '', 'taken.ts', 'someone else');
      await buffersStore.getState().reload('p', 'taken.ts');
    });
    expect(screen.getByTestId('editor-recovered')).toBeTruthy();
    expect(screen.getByText(/taken\.recovered\.ts/)).toBeTruthy();
    expect(await workspace.readFile('p', 'taken.recovered.ts')).toBe('my edits');
    await act(async () => fireEvent.press(screen.getByText('OK')));
    expect(screen.queryByTestId('editor-recovered')).toBeNull();
  });
});
