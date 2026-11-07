// The explorer: filtering, git colors, collapse all and the long-press menu.
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TreeNode } from './workspace';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../external/share', () => ({ shareFile: jest.fn() }));
jest.mock('../../extensions/themes', () => ({ FileIcon: ({ fallback }: { fallback: unknown }) => fallback }));
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', contrast: 'normal', haptics: false }));
  const projectsStore = createStore(() => ({
    loadTree: jest.fn(async () => undefined),
    moveEntry: jest.fn(async (_p: string, _from: string, to: string) => to),
    renameEntry: jest.fn(),
    deleteEntry: jest.fn(),
    createFile: jest.fn(),
    createFolder: jest.fn(),
  }));
  return { projectsStore, settingsStore: settings, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});
jest.mock('../git/status', () => {
  const actual = jest.requireActual('../git/status');
  const status = ' M src/lib/a.ts\n?? new.ts\n';
  const run = jest.fn(async (_p: string, args: string[]) => ({ code: 0, stdout: args[0] === 'status' ? status : '* main\n' }));
  const gitStatusStore = actual.createGitStatusStore(run);
  const { useStore } = jest.requireActual('zustand');
  return { ...actual, run, gitStatusStore, useGitStatus: (sel: (s: unknown) => unknown) => useStore(gitStatusStore, sel) };
});

import * as Clipboard from 'expo-clipboard';
import { projectsStore } from '../../state';
import { FileTree } from './FileTree';

const tree: TreeNode[] = [
  {
    name: 'src',
    path: 'src',
    kind: 'dir',
    children: [
      { name: 'lib', path: 'src/lib', kind: 'dir', children: [{ name: 'a.ts', path: 'src/lib/a.ts', kind: 'file' }] },
      { name: 'index.ts', path: 'src/index.ts', kind: 'file' },
    ],
  },
  { name: 'new.ts', path: 'new.ts', kind: 'file' },
];

const setup = async () => {
  const onOpenFile = jest.fn();
  await render(<FileTree project="p" nodes={tree} activePath="new.ts" onOpenFile={onOpenFile} />);
  return { onOpenFile };
};

describe('FileTree', () => {
  it('filters to matching files and opens their folders', async () => {
    await setup();
    expect(screen.queryByTestId('tree-src/lib/a.ts')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('tree-filter'), 'A.T');
    expect(screen.getByTestId('tree-src/lib/a.ts')).toBeTruthy();
    expect(screen.queryByTestId('tree-src/index.ts')).toBeNull();
    expect(screen.queryByTestId('tree-new.ts')).toBeNull();
    await fireEvent.press(screen.getByTestId('tree-filter-clear'));
    expect(screen.getByTestId('tree-new.ts')).toBeTruthy();
    expect(screen.queryByTestId('tree-src/lib/a.ts')).toBeNull();
    await screen.findByText('U');
  });

  it('colors changed files and marks their folders', async () => {
    await setup();
    expect(await screen.findByLabelText('new.ts, file, untracked')).toBeTruthy();
    expect(screen.getByLabelText('src, folder, has changes')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tree-src'));
    await fireEvent.press(screen.getByTestId('tree-src/lib'));
    expect(screen.getByLabelText('a.ts, file, modified')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tree-collapse-all'));
    expect(screen.queryByTestId('tree-src/lib')).toBeNull();
  });

  it('opens files and refreshes the tree', async () => {
    const { onOpenFile } = await setup();
    await fireEvent.press(screen.getByTestId('tree-new.ts'));
    expect(onOpenFile).toHaveBeenCalledWith('new.ts');
    await fireEvent.press(screen.getByTestId('tree-refresh'));
    expect(projectsStore.getState().loadTree).toHaveBeenCalledWith('p');
    await screen.findByText('U');
  });

  it('copies a path and moves a file from the long-press menu', async () => {
    await setup();
    await fireEvent(screen.getByTestId('tree-new.ts'), 'longPress');
    await fireEvent.press(screen.getByText('Copy path'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('new.ts');

    await fireEvent(screen.getByTestId('tree-new.ts'), 'longPress');
    await fireEvent.press(screen.getByText('Move to…'));
    await fireEvent.changeText(screen.getByPlaceholderText('folder (empty for the project root)'), 'src/lib/');
    await fireEvent.press(screen.getByText('Move'));
    await screen.findByText('U');
    expect(projectsStore.getState().moveEntry).toHaveBeenCalledWith('p', 'new.ts', 'src/lib/new.ts');
  });
});
