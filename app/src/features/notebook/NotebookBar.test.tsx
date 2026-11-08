// Run all, then Stop: the run is killed and the buttons come back.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('../env/store', () => ({ projectEnv: async () => ({}) }));
const mockSent: unknown[] = [];
jest.mock('../../runtime', () => ({
  // Python that never finishes.
  localRunner: { run: () => undefined, send: (msg: unknown) => mockSent.push(msg) },
}));
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createStore, useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const settings = createStore(() => ({ theme: 'dark', contrast: 'normal' }));
  return { workspace, buffersStore: createBuffersStore(workspace), settingsStore: settings, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});

import { workspace } from '../../state';
import { NotebookBar } from './NotebookBar';

it('stops a run that never finishes and re-enables the buttons', async () => {
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', 'nb.ipynb', JSON.stringify({ cells: [{ cell_type: 'code', source: 'while True: pass' }] }));
  await render(<NotebookBar project="p" path="nb.ipynb" />);
  // Not awaited: the run only ends when stopped.
  await act(async () => {
    fireEvent.press(screen.getByTestId('notebook-run-all'));
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(screen.getByTestId('notebook-stop')).toBeTruthy();
  expect(screen.getByTestId('notebook-run-all').props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => {
    fireEvent.press(screen.getByTestId('notebook-stop'));
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(mockSent).toEqual([{ type: 'kill', id: expect.stringMatching(/^notebook-/) }]);
  expect(screen.queryByTestId('notebook-stop')).toBeNull();
  expect(screen.getByText('Stopped.')).toBeTruthy();
  expect(screen.getByTestId('notebook-run-all').props.accessibilityState).toMatchObject({ disabled: false });
  // The driver script is cleaned up.
  expect(await workspace.stat('p', '.tide-notebook.py')).toBeNull();
});
