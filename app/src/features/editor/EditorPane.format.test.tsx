// .editorconfig indentation, format on save, the selection for the word
// count, and the image / notice messages, with the WebView replaced by a
// recorder of the messages the pane sends it.
import { act, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('../../components/a11y', () => ({ ...jest.requireActual('../../components/a11y'), useScreenReader: () => false }));
const mockShare = jest.fn(async (_name: string, _base64: string) => undefined);
jest.mock('./shareImage', () => ({ shareCodeImage: (name: string, base64: string) => mockShare(name, base64) }));
let mockSent: { type: string; [k: string]: unknown }[] = [];
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
    trimTrailingWhitespace: true,
    insertFinalNewline: false,
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

import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { EditorPane } from './EditorPane';
import { selectionStore } from './selection';

const host = { request: async () => null, definition: () => undefined, cursor: () => undefined, save: () => undefined };
const features = { language: true, breakpoints: false, conflicts: false };
const message = (msg: object) => act(async () => mockOnMessage({ nativeEvent: { data: JSON.stringify(msg) } }));

async function openFile(path: string) {
  mockSent = [];
  await render(
    <EditorPane project="p" path={path} features={features} host={host} onBrowse={() => undefined} onShortcut={() => undefined} onFocusChange={() => undefined} />,
  );
  await message({ type: 'ready' });
}

beforeAll(async () => {
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', '.editorconfig', 'root = true\n[*]\nindent_style = space\nindent_size = 2\n[Makefile]\nindent_style = tab\n[*.md]\ntrim_trailing_whitespace = false');
  await workspace.createFile('p', '', 'Makefile', 'all:\n\techo hi\n');
  await workspace.createFile('p', '', 'a.js', 'x');
  await workspace.createFile('p', '', 'notes.md', 'x');
});

// [*] sets indent_size = 2, which the Makefile's tabs inherit.
it('opens a file with the indentation its .editorconfig gives', async () => {
  await openFile('Makefile');
  expect(mockSent.find((m) => m.type === 'open')).toMatchObject({ path: 'Makefile', indent: { unit: 'tab', size: 2, tabWidth: 2 } });
  await openFile('a.js');
  expect(mockSent.find((m) => m.type === 'open')).toMatchObject({ path: 'a.js', indent: { unit: 'space', size: 2, tabWidth: 2 } });
});

it('trims on save from the setting, sends the trimmed text back into the editor, and lets .editorconfig override it', async () => {
  await openFile('a.js');
  await message({ type: 'change', path: 'a.js', content: 'let a = 1;   \nb()' });
  await act(async () => buffersStore.getState().save('p', 'a.js'));
  expect(await workspace.readFile('p', 'a.js')).toBe('let a = 1;\nb()');
  expect(mockSent.filter((m) => m.type === 'setContent').pop()).toEqual({ type: 'setContent', path: 'a.js', content: 'let a = 1;\nb()', base: 'let a = 1;   \nb()' });

  await openFile('notes.md');
  await message({ type: 'change', path: 'notes.md', content: 'keep \n' });
  await act(async () => buffersStore.getState().save('p', 'notes.md'));
  expect(await workspace.readFile('p', 'notes.md')).toBe('keep \n');
  expect(buffersStore.getState().buffers[bufferKey('p', 'notes.md')].content).toBe('keep \n');
});

it('keeps the selection the editor reports, for the word count and autosave', async () => {
  await openFile('notes.md');
  await message({ type: 'cursor', path: 'notes.md', offset: 4, anchor: 1 });
  expect(selectionStore.getState()).toEqual({ project: 'p', path: 'notes.md', anchor: 1, head: 4 });
  await message({ type: 'cursor', path: 'notes.md', offset: 2 });
  expect(selectionStore.getState()).toMatchObject({ anchor: 2, head: 2 });
});

it('shares the image the editor drew, and shows its notices', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await openFile('a.js');
  await message({ type: 'image', path: 'a.js', name: 'a.png', base64: 'iVBOR' });
  expect(mockShare).toHaveBeenCalledWith('a.png', 'iVBOR');
  await message({ type: 'notice', title: "Can't share as an image", message: 'Too long' });
  expect(alert).toHaveBeenCalledWith("Can't share as an image", 'Too long');
  alert.mockRestore();
});
