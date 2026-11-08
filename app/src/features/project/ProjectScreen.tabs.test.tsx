// Tabs on the project screen: reopening closed ones, pinning, closing the
// others, and revealing the open file in the tree, on a phone and an iPad.
// WebViews, the terminal and the extensions are stubbed as in the split test.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
let mockWidth = 1024;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: mockWidth, height: 768, scale: 2, fontScale: 1 }) }));
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
// The trees (drawer or sidebar) as last rendered: what they were asked to reveal.
let mockReveals: unknown[] = [];
jest.mock('../files/FileTree', () => ({
  FileTree: (props: { reveal: unknown }) => {
    mockReveals.push(props.reveal);
    return null;
  },
}));
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
// The left editor's shortcut callback, as a hardware keyboard reaches it.
let mockShortcut: (id: string) => void = () => undefined;
// Each editor pane shows its file and can report focus, like the WebView does.
jest.mock('../editor/EditorPane', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    EditorPane: React.forwardRef(function Fake(props: { path: string | null; onFocusChange(f: boolean): void; onShortcut(id: string): void }, ref: React.Ref<unknown>) {
      mockShortcut = props.onShortcut;
      React.useImperativeHandle(ref, () => ({ send: () => undefined, reveal: () => undefined, flush: () => mockFlush() }));
      return React.createElement(Pressable, { onPress: () => props.onFocusChange(true), testID: 'pane' }, React.createElement(Text, null, `file:${props.path}`));
    }),
  };
});


import { tabsStore, workspace } from '../../state';
import { ProjectScreen } from './ProjectScreen';

const run = (id: string) => act(async () => mockCommands.find((c) => c.id === id)!.run());
const tabsOf = (project: string) => tabsStore.getState().byProject[project];

async function projectWith(project: string, files: string[]) {
  await workspace.createEmptyProject(project);
  for (const f of files) {
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const parts = dir ? dir.split('/') : [];
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (!(await workspace.stat(project, parts.slice(0, i + 1).join('/')))) await workspace.createFolder(project, parent, parts[i]);
    }
    await workspace.createFile(project, dir, f.slice(f.lastIndexOf('/') + 1), '');
    tabsStore.getState().openTab(project, f);
  }
}

beforeEach(() => {
  mockWidth = 1024;
  mockReveals = [];
});

it('reopens closed tabs with ⇧⌘T and the palette, where they were, skipping deleted files', async () => {
  await projectWith('reopen', ['a.js', 'b.js', 'c.js', 'd.js']);
  await render(<ProjectScreen project="reopen" />);
  await act(async () => tabsStore.getState().openTab('reopen', 'b.js'));
  await run('close-tab');
  await act(async () => tabsStore.getState().openTab('reopen', 'd.js'));
  await run('close-tab');
  expect(tabsOf('reopen').open).toEqual(['a.js', 'c.js']);
  // d.js is deleted meanwhile, so b.js comes back, in its old place.
  await workspace.deleteEntry('reopen', 'd.js');
  expect(mockCommands.find((c) => c.id === 'reopen-tab')).toMatchObject({ title: 'Reopen closed tab', hint: '⇧⌘T' });
  await run('reopen-tab');
  expect(tabsOf('reopen')).toEqual({ open: ['a.js', 'b.js', 'c.js'], active: 'b.js' });
  expect(screen.getByText('file:b.js')).toBeTruthy();

  // ⇧⌘T from the editor does the same.
  await run('close-tab');
  expect(tabsOf('reopen').open).toEqual(['a.js', 'c.js']);
  await act(async () => mockShortcut('reopen-tab'));
  expect(tabsOf('reopen')).toEqual({ open: ['a.js', 'b.js', 'c.js'], active: 'b.js' });
});

it('pins and unpins the open tab from the palette and keeps pinned tabs on Close other tabs', async () => {
  await projectWith('pins', ['a.js', 'b.js', 'c.js']);
  await render(<ProjectScreen project="pins" />);
  // c.js is active.
  await run('tab.pin');
  expect(tabsOf('pins')).toEqual({ open: ['c.js', 'a.js', 'b.js'], active: 'c.js', pinned: ['c.js'] });
  expect(screen.getByTestId('pin-c.js')).toBeTruthy();
  expect(mockCommands.find((c) => c.id === 'tab.pin')).toBeUndefined();
  expect(mockCommands.find((c) => c.id === 'tab.unpin')).toMatchObject({ title: 'Unpin tab' });

  // Close other tabs, from a's long-press menu: c stays because it's pinned.
  await fireEvent(screen.getByTestId('tab-a.js'), 'longPress');
  await fireEvent.press(screen.getByText('Close other tabs'));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(tabsOf('pins').open).toEqual(['c.js', 'a.js']);

  // Close all keeps the pinned one too.
  await run('close-all-tabs');
  expect(tabsOf('pins').open).toEqual(['c.js']);
  await run('tab.unpin');
  expect(tabsOf('pins')).toEqual({ open: ['c.js'], active: 'c.js' });
  expect(screen.queryByTestId('pin-c.js')).toBeNull();
});

it('reveals the open file in the sidebar from the palette and the breadcrumbs (iPad)', async () => {
  await projectWith('reveal', ['src/lib/c.js']);
  await render(<ProjectScreen project="reveal" />);
  // Hide the sidebar first: revealing brings it back.
  await run('files');
  expect(screen.queryByTestId('sidebar')).toBeNull();
  await run('reveal-file');
  expect(screen.getByTestId('sidebar')).toBeTruthy();
  expect(mockReveals[mockReveals.length - 1]).toEqual({ path: 'src/lib/c.js', nonce: 1 });

  await fireEvent.press(within(screen.getByTestId('breadcrumbs')).getByText('c.js'));
  expect(mockReveals[mockReveals.length - 1]).toEqual({ path: 'src/lib/c.js', nonce: 2 });
});

it('reveals the open file in the drawer on a phone, where pinned tabs have no close button', async () => {
  mockWidth = 390;
  await projectWith('phone', ['a.js', 'src/b.js']);
  tabsStore.getState().pinTab('phone', 'a.js');
  await render(<ProjectScreen project="phone" />);
  expect(screen.queryByTestId('close-a.js')).toBeNull();
  expect(screen.getByTestId('close-src/b.js')).toBeTruthy();
  // The tab menu's Reveal opens the drawer.
  expect(screen.getByTestId('activity-files').props.accessibilityState).toEqual({ selected: false });
  await fireEvent(screen.getByTestId('tab-src/b.js'), 'longPress');
  await fireEvent.press(screen.getByText('Reveal in file tree'));
  expect(mockReveals[mockReveals.length - 1]).toEqual({ path: 'src/b.js', nonce: 1 });
  expect(screen.getByTestId('activity-files').props.accessibilityState).toEqual({ selected: true });
});
