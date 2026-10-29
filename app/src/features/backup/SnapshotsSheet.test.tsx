import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createSnapshots } = jest.requireActual('./snapshots');
  const { createStore, useStore } = jest.requireActual('zustand');
  const fs = createMemoryFs();
  const workspace = createWorkspace(fs);
  let clock = 1_000_000;
  const settings = createStore(() => ({ theme: 'dark' }));
  return {
    workspace,
    snapshots: createSnapshots(fs, workspace, () => (clock += 60_000)),
    buffersStore: createBuffersStore(workspace),
    projectsStore: createStore(() => ({ loadTree: async () => undefined })),
    tabsStore: createStore(() => ({ byProject: {} })),
    useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel),
  };
});

import { workspace } from '../../state';
import { SnapshotsSheet } from './SnapshotsSheet';

const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));

it('takes a snapshot, restores it and can undo the restore', async () => {
  // Confirm every alert by pressing its destructive button.
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
  await workspace.createProject('p', 'node-hello');
  await workspace.createFile('p', '', 'notes.txt', 'v1');
  await render(<SnapshotsSheet project="p" onClose={() => undefined} />);
  await settle();
  expect(screen.getByText('No snapshots yet.')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('take-snapshot'));
  await settle();
  expect(screen.getByText(/Taken by you/)).toBeTruthy();

  await workspace.writeFile('p', 'notes.txt', 'v2');
  const restore = screen.getAllByText('Restore')[0];
  await fireEvent.press(restore);
  await settle();
  expect(await workspace.readFile('p', 'notes.txt')).toBe('v1');
  expect(screen.getByText(/Before a restore/)).toBeTruthy();
});
