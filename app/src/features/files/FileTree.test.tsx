// The explorer: filtering, git colors, collapse all and the long-press menu.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

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
    copyEntry: jest.fn(async (_p: string, _from: string, to: string) => to),
  }));
  // Only what Duplicate asks of the workspace: "a copy.ts" is taken.
  const workspace = {
    duplicatePath: jest.fn(async (_p: string, path: string) => {
      const { copyName } = jest.requireActual('./workspace');
      const dot = path.lastIndexOf('/');
      return `${dot === -1 ? '' : path.slice(0, dot + 1)}${copyName(path.slice(dot + 1), path.endsWith('a.ts') ? 2 : 1)}`;
    }),
  };
  return { projectsStore, workspace, settingsStore: settings, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
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
import { FlatList } from 'react-native';
import { projectsStore, workspace } from '../../state';
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

  it('says when a delete fails instead of leaving the rejection unhandled', async () => {
    (projectsStore.getState().deleteEntry as jest.Mock).mockRejectedValueOnce(new Error('Permission denied'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    });
    const calls: unknown[][] = [];
    try {
      await setup();
      await fireEvent(screen.getByTestId('tree-new.ts'), 'longPress');
      await fireEvent.press(screen.getByText('Delete'));
      await act(async () => new Promise((r) => setTimeout(r, 0)));
      calls.push(...alert.mock.calls);
    } finally {
      alert.mockRestore();
    }
    expect(projectsStore.getState().deleteEntry).toHaveBeenCalledWith('p', 'new.ts');
    expect(calls).toContainEqual(["Couldn't delete new.ts", 'Permission denied']);
    await screen.findByText('U');
  });

  it('duplicates a file beside it from the long-press menu and opens the copy', async () => {
    const { onOpenFile } = await setup();
    // Folders don't offer it.
    await fireEvent(screen.getByTestId('tree-src'), 'longPress');
    expect(screen.queryByText('Duplicate')).toBeNull();
    await fireEvent.press(screen.getByText('Rename'));
    await fireEvent.press(screen.getByText('Cancel'));

    await fireEvent(screen.getByTestId('tree-new.ts'), 'longPress');
    await fireEvent.press(screen.getByText('Duplicate'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(workspace.duplicatePath).toHaveBeenCalledWith('p', 'new.ts');
    expect(projectsStore.getState().copyEntry).toHaveBeenCalledWith('p', 'new.ts', 'new copy.ts');
    expect(onOpenFile).toHaveBeenCalledWith('new copy.ts');
    await screen.findByText('U');
  });

  it('says when a duplicate fails', async () => {
    (projectsStore.getState().copyEntry as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const { onOpenFile } = await setup();
      await fireEvent(screen.getByTestId('tree-new.ts'), 'longPress');
      await fireEvent.press(screen.getByText('Duplicate'));
      await act(async () => new Promise((r) => setTimeout(r, 0)));
      expect(alert).toHaveBeenCalledWith("Couldn't duplicate new.ts", 'Disk full');
      expect(onOpenFile).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
    await screen.findByText('U');
  });

  it('reveals a file: clears the filter, opens its folders, scrolls to it and highlights it', async () => {
    jest.useFakeTimers();
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    try {
      const props = { project: 'p', nodes: tree, activePath: 'new.ts', onOpenFile: jest.fn() };
      const { rerender } = await render(<FileTree {...props} />);
      await fireEvent.changeText(screen.getByTestId('tree-filter'), 'index');
      expect(screen.queryByTestId('tree-src/lib')).toBeNull();

      await rerender(<FileTree {...props} reveal={{ path: 'src/lib/a.ts', nonce: 1 }} />);
      expect(screen.getByTestId('tree-filter').props.value).toBe('');
      const row = screen.getByTestId('tree-src/lib/a.ts');
      expect(screen.getByTestId('tree-src/index.ts')).toBeTruthy();
      // src, src/lib, then a.ts.
      expect(scroll).toHaveBeenCalledWith({ index: 2, viewPosition: 0.5, animated: true });
      expect(row).toHaveStyle({ borderWidth: expect.any(Number) });
      await act(async () => jest.advanceTimersByTime(2000));
      expect(screen.getByTestId('tree-src/lib/a.ts')).not.toHaveStyle({ borderWidth: expect.any(Number) });

      // Revealing the same file again scrolls again.
      scroll.mockClear();
      await rerender(<FileTree {...props} reveal={{ path: 'src/lib/a.ts', nonce: 2 }} />);
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      scroll.mockRestore();
      jest.useRealTimers();
    }
  });
});
