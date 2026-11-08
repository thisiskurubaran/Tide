// The split editor on an iPad-width screen. WebViews, the terminal and the
// extensions are stubbed; this checks which pane gets which file.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 1024, height: 768, scale: 2, fontScale: 1 }) }));
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createTabsStore } = jest.requireActual('../../state/tabs');
  const { createStore, useStore } = jest.requireActual('zustand');
  const storage = { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined };
  const workspace = createWorkspace(createMemoryFs());
  const buffersStore = createBuffersStore(workspace);
  const tabsStore = createTabsStore(storage);
  const projectsStore = createStore(() => ({ trees: {}, loadTree: async () => undefined }));
  const settings = createStore(() => ({ theme: 'dark' }));
  const runnerStore = createStore(() => ({ mode: 'local', configs: {}, setMode: () => undefined, setConfig: () => undefined }));
  return {
    storage,
    workspace,
    buffersStore,
    tabsStore,
    projectsStore,
    runnerStore,
    settingsStore: settings,
    useTabs: (sel: (s: unknown) => unknown) => useStore(tabsStore, sel),
    useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel),
    useProjects: (sel: (s: unknown) => unknown) => useStore(projectsStore, sel),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel),
    useRunner: (sel: (s: unknown) => unknown) => useStore(runnerStore, sel),
    onProjectChange: () => undefined,
  };
});
jest.mock('../../extensions/host', () => ({
  useActiveExtensions: () => [],
  editorFeatures: () => ({ language: false, breakpoints: false, conflicts: false }),
  useExtensionHost: () => undefined,
  answerRequest: async () => null,
  findDefinition: async () => [],
  saveWithHooks: async () => undefined,
}));
jest.mock('../../extensions/gitPro', () => ({ GIT_PRO_PANEL: 'git-pro' }));
jest.mock('../git/status', () => {
  const { createGitStatusStore } = jest.requireActual('../git/status');
  const { useStore } = jest.requireActual('zustand');
  const gitStatusStore = createGitStatusStore(async () => ({ code: 128, stdout: '' }));
  return { gitStatusStore, useGitStatus: (sel: (s: unknown) => unknown) => useStore(gitStatusStore, sel) };
});
jest.mock('../../state/recents', () => ({ recentsStore: { getState: () => ({ touchProject: () => undefined }) } }));
jest.mock('./TerminalPanel', () => ({ TerminalPanel: () => null }));
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('../git/SourceControlSheet', () => ({ SourceControlSheet: () => null }));
jest.mock('../ai/AiSheet', () => ({ AiSheet: () => null }));
jest.mock('../notebook/NotebookBar', () => ({ NotebookBar: () => null }));
jest.mock('../search/SearchPanel', () => ({ SearchPanel: () => null }));
jest.mock('../packages/PackagesSheet', () => ({ PackagesSheet: () => null }));
jest.mock('../tests/TestsSheet', () => ({ TestsSheet: () => null }));
jest.mock('../external', () => ({ pullFolder: jest.fn(), pushFolder: jest.fn(), useLinked: () => undefined }));
jest.mock('../external/LinkedFolderSheet', () => ({ LinkedFolderSheet: () => null }));
jest.mock('../files/FileTree', () => ({ FileTree: () => null }));
let mockCompare: unknown = null;
jest.mock('../diff/CompareView', () => ({
  CompareView: (props: { request: unknown }) => {
    mockCompare = props.request;
    return null;
  },
}));
jest.mock('../preview/PreviewPane', () => {
  const { Text } = jest.requireActual('react-native');
  return { PreviewPane: ({ path }: { path: string }) => <Text>{`preview:${path}`}</Text> };
});
// The palette's commands, as the screen last rendered them.
let mockCommands: { id: string; run(): void }[] = [];
jest.mock('../search/CommandPalette', () => ({
  CommandPalette: (props: { commands: typeof mockCommands }) => {
    mockCommands = props.commands;
    return null;
  },
}));
// What a pane's flush() does: by default nothing, like an editor with no typing pending.
let mockFlush: () => Promise<void> = async () => undefined;
// Each editor pane shows its file and can report focus, like the WebView does.
jest.mock('../editor/EditorPane', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    EditorPane: React.forwardRef(function Fake(props: { path: string | null; onFocusChange(f: boolean): void }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ send: () => undefined, reveal: () => undefined, flush: () => mockFlush() }));
      return React.createElement(Pressable, { onPress: () => props.onFocusChange(true), testID: 'pane' }, React.createElement(Text, null, `file:${props.path}`));
    }),
  };
});

import { buffersStore, tabsStore, workspace } from '../../state';
import { ProjectScreen } from './ProjectScreen';

it('splits the editor and sends opened files to the focused pane', async () => {
  tabsStore.getState().openTab('p', 'a.js');
  await render(<ProjectScreen project="p" />);
  expect(screen.getAllByTestId('pane')).toHaveLength(1);

  const commands = () => mockCommands;
  // Split: both show a.js, the new right pane is focused.
  await act(async () => commands().find((c) => c.id === 'split')!.run());
  expect(screen.getAllByText('file:a.js')).toHaveLength(2);
  expect(screen.getByTestId('split-divider')).toBeTruthy();

  // Opening a file goes to the right pane; the left keeps a.js.
  await act(async () => tabsStore.getState().openTab('p', 'b.js', false));
  await act(async () => commands().find((c) => c.id === 'next-tab')!.run());
  expect(screen.getByText('file:a.js')).toBeTruthy();
  expect(screen.getByText('file:b.js')).toBeTruthy();
  expect(tabsStore.getState().byProject.p.active).toBe('a.js');

  // Focus the left pane; tabs now drive it.
  await fireEvent.press(screen.getAllByTestId('pane')[0]);
  await act(async () => commands().find((c) => c.id === 'next-tab')!.run());
  expect(screen.getAllByText('file:b.js')).toHaveLength(2);

  // Closing b.js moves the right pane to the neighbour, then unsplit.
  await act(async () => commands().find((c) => c.id === 'close-tab')!.run());
  expect(screen.getAllByText('file:a.js')).toHaveLength(2);
  await act(async () => commands().find((c) => c.id === 'split')!.run());
  expect(screen.getAllByTestId('pane')).toHaveLength(1);
});

it('opens the file a tide:// link asks for', async () => {
  await render(<ProjectScreen project="linked" launch={{ file: 'src/app.ts', line: 3 }} />);
  expect(tabsStore.getState().byProject.linked).toEqual({ open: ['src/app.ts'], active: 'src/app.ts' });
  expect(screen.getByText('file:src/app.ts')).toBeTruthy();
});

it('previews Markdown on request and notebooks from the start', async () => {
  tabsStore.getState().openTab('docs', 'README.md');
  await render(<ProjectScreen project="docs" />);
  expect(screen.queryByText('preview:README.md')).toBeNull();
  await fireEvent.press(screen.getByTestId('toggle-preview'));
  expect(screen.getByText('preview:README.md')).toBeTruthy();
  await act(async () => mockCommands.find((c) => c.id === 'preview')!.run());
  expect(screen.queryByText('preview:README.md')).toBeNull();

  await act(async () => tabsStore.getState().openTab('docs', 'analysis.ipynb'));
  expect(screen.getByText('preview:analysis.ipynb')).toBeTruthy();
});

it('offers tide.json configurations and tasks in the palette', async () => {
  const { workspace } = jest.requireMock('../../state');
  await workspace.createEmptyProject('tasks');
  await workspace.createFile(
    'tasks',
    '',
    'tide.json',
    JSON.stringify({ runtime: 'node', entry: 'index.js', configurations: [{ name: 'Server', entry: 'server.js' }], tasks: [{ name: 'Test', command: 'node --test' }] }),
  );
  await render(<ProjectScreen project="tasks" />);
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  const ids = mockCommands.map((c) => c.id);
  expect(ids).toEqual(expect.arrayContaining(['run-config:Default', 'run-config:Server', 'task:Test']));
  expect(mockCommands.find((c) => c.id === 'run')).toMatchObject({ title: 'Run project (Default)' });
});

it('offers the merge editor for files with conflicts', async () => {
  const { buffersStore, workspace } = jest.requireMock('../../state');
  await workspace.createEmptyProject('merge');
  await workspace.createFile('merge', '', 'a.txt', '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n');
  tabsStore.getState().openTab('merge', 'a.txt');
  await buffersStore.getState().load('merge', 'a.txt');
  await render(<ProjectScreen project="merge" />);
  const ids = mockCommands.map((c) => c.id);
  expect(ids).toEqual(expect.arrayContaining(['compare.merge', 'compare.head', 'compare.file']));
  expect(ids).not.toContain('compare.saved');
  await act(async () => mockCommands.find((c) => c.id === 'compare.merge')!.run());
  expect(mockCompare).toEqual({ path: 'a.txt', with: 'merge' });
});

it('saves the keystrokes the editor still held back when a tab closes', async () => {
  await workspace.createEmptyProject('closing');
  await workspace.createFile('closing', '', 'x.js', 'old');
  await buffersStore.getState().load('closing', 'x.js');
  tabsStore.getState().openTab('closing', 'x.js');
  // The editor's debounced change arrives in answer to the flush.
  mockFlush = async () => buffersStore.getState().edit('closing', 'x.js', 'typed just now');
  try {
    await render(<ProjectScreen project="closing" />);
    await act(async () => mockCommands.find((c) => c.id === 'close-tab')!.run());
  } finally {
    mockFlush = async () => undefined;
  }
  expect(await workspace.readFile('closing', 'x.js')).toBe('typed just now');
  expect(tabsStore.getState().byProject.closing.open).toEqual([]);
});

describe('a deleted file with unsaved edits', () => {
  async function deletedTab(project: string) {
    await workspace.createEmptyProject(project);
    await workspace.createFile(project, '', 'gone.js', 'old');
    await buffersStore.getState().load(project, 'gone.js');
    tabsStore.getState().openTab(project, 'gone.js');
    buffersStore.getState().edit(project, 'gone.js', 'unsaved');
    await workspace.deleteEntry(project, 'gone.js');
    await buffersStore.getState().reload(project, 'gone.js');
  }
  type Buttons = { text: string; onPress?(): void }[];
  const answer = (text: string) =>
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => (buttons as Buttons).find((b) => b.text === text)!.onPress!());

  it('asks before closing its tab, and keeps it on Cancel', async () => {
    await deletedTab('ask');
    const alert = answer('Cancel');
    let calls: unknown[][] = [];
    try {
      await render(<ProjectScreen project="ask" />);
      await act(async () => mockCommands.find((c) => c.id === 'close-tab')!.run());
      calls = alert.mock.calls;
    } finally {
      alert.mockRestore();
    }
    expect(calls).toEqual([['gone.js was deleted', expect.any(String), expect.any(Array), expect.anything()]]);
    expect(tabsStore.getState().byProject.ask.open).toEqual(['gone.js']);
    expect(buffersStore.getState().buffers['ask\u0000gone.js']).toMatchObject({ content: 'unsaved', deleted: true });
  });

  it("discards the edits on Don't save, and saves them again on Save as new file", async () => {
    await deletedTab('discard');
    let alert = answer("Don't save");
    try {
      await render(<ProjectScreen project="discard" />);
      await act(async () => mockCommands.find((c) => c.id === 'close-tab')!.run());
    } finally {
      alert.mockRestore();
    }
    expect(tabsStore.getState().byProject.discard.open).toEqual([]);
    expect(buffersStore.getState().buffers['discard\u0000gone.js']).toBeUndefined();

    await deletedTab('recreate');
    alert = answer('Save as new file');
    try {
      await render(<ProjectScreen project="recreate" />);
      await act(async () => mockCommands.find((c) => c.id === 'close-tab')!.run());
    } finally {
      alert.mockRestore();
    }
    expect(await workspace.readFile('recreate', 'gone.js')).toBe('unsaved');
    expect(tabsStore.getState().byProject.recreate.open).toEqual([]);
  });
});

it('moves the right pane off a file that was deleted or renamed outside closeFile', async () => {
  tabsStore.getState().openTab('follow', 'a.js');
  tabsStore.getState().openTab('follow', 'b.js', false);
  await render(<ProjectScreen project="follow" />);
  await act(async () => mockCommands.find((c) => c.id === 'split')!.run());
  await act(async () => mockCommands.find((c) => c.id === 'next-tab')!.run());
  expect(screen.getByText('file:b.js')).toBeTruthy();
  // Renamed in the tree: the pane follows.
  await act(async () => tabsStore.getState().renamePath('follow', 'b.js', 'c.js'));
  expect(screen.getByText('file:c.js')).toBeTruthy();
  // Deleted on disk (the buffers' gone hook): the pane moves to what's left.
  await act(async () => tabsStore.getState().removePath('follow', 'c.js'));
  expect(screen.queryByText('file:c.js')).toBeNull();
  expect(screen.getAllByText('file:a.js')).toHaveLength(2);
});

it('gets the editor’s last keystrokes in before Run', async () => {
  await workspace.createEmptyProject('running');
  await workspace.createFile('running', '', 'tide.json', JSON.stringify({ runtime: 'node', entry: 'index.js' }));
  await workspace.createFile('running', '', 'index.js', 'old');
  await buffersStore.getState().load('running', 'index.js');
  tabsStore.getState().openTab('running', 'index.js');
  mockFlush = async () => buffersStore.getState().edit('running', 'index.js', 'typed just now');
  try {
    await render(<ProjectScreen project="running" />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => mockCommands.find((c) => c.id === 'run')!.run());
  } finally {
    mockFlush = async () => undefined;
  }
  expect(await workspace.readFile('running', 'index.js')).toBe('typed just now');
});
