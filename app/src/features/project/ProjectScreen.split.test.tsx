// The split editor on an iPad-width screen. WebViews, the terminal and the
// extensions are stubbed; this checks which pane gets which file.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

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
  const runnerStore = createStore(() => ({ mode: 'local', setMode: () => undefined }));
  return {
    storage,
    workspace,
    buffersStore,
    tabsStore,
    projectsStore,
    runnerStore,
    useTabs: (sel: (s: unknown) => unknown) => useStore(tabsStore, sel),
    useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel),
    useProjects: (sel: (s: unknown) => unknown) => useStore(projectsStore, sel),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel),
    useRunner: (sel: (s: unknown) => unknown) => useStore(runnerStore, sel),
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
jest.mock('./TerminalPanel', () => ({ TerminalPanel: () => null }));
jest.mock('../git/SourceControlSheet', () => ({ SourceControlSheet: () => null }));
jest.mock('../search/SearchPanel', () => ({ SearchPanel: () => null }));
jest.mock('../files/FileTree', () => ({ FileTree: () => null }));
// The palette's commands, as the screen last rendered them.
let mockCommands: { id: string; run(): void }[] = [];
jest.mock('../search/CommandPalette', () => ({
  CommandPalette: (props: { commands: typeof mockCommands }) => {
    mockCommands = props.commands;
    return null;
  },
}));
// Each editor pane shows its file and can report focus, like the WebView does.
jest.mock('../editor/EditorPane', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    EditorPane: React.forwardRef(function Fake(props: { path: string | null; onFocusChange(f: boolean): void }, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ send: () => undefined, reveal: () => undefined }));
      return React.createElement(Pressable, { onPress: () => props.onFocusChange(true), testID: 'pane' }, React.createElement(Text, null, `file:${props.path}`));
    }),
  };
});

import { tabsStore } from '../../state';
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
