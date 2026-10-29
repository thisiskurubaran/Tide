import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createStore, useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const settings = createStore(() => ({ theme: 'dark' }));
  return {
    workspace,
    buffersStore: createBuffersStore(workspace),
    useSettings: (selector: (s: unknown) => unknown) => useStore(settings, selector),
  };
});

import { buffersStore, workspace } from '../../state';
import { SearchPanel } from './SearchPanel';

const wait = () => act(async () => new Promise((r) => setTimeout(r, 400)));

it('searches with a regular expression and replaces in one file', async () => {
  await workspace.createProject('p', 'node-hello');
  await workspace.createFile('p', '', 'a.js', 'const port = 3000;\nconst host = 1;\n');
  await workspace.createFile('p', '', 'b.js', 'port = 4000;\n');
  // An open file with unsaved edits: replace has to see them and keep the buffer in step.
  await buffersStore.getState().load('p', 'b.js');
  buffersStore.getState().edit('p', 'b.js', 'port = 5000;\n');

  await render(<SearchPanel visible project="p" onOpen={() => undefined} onClose={() => undefined} />);
  await fireEvent.changeText(screen.getByTestId('search-input'), 'port = (\\d+)');
  await fireEvent.press(screen.getByTestId('search-regex'));
  await wait();
  expect(screen.getByText('2 results in 2 files')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('search-toggle-replace'));
  await fireEvent.changeText(screen.getByTestId('replace-input'), 'port = Number($1)');
  await fireEvent.press(screen.getByTestId('replace-file-b.js'));
  await wait();
  expect(await workspace.readFile('p', 'b.js')).toBe('port = Number(5000);\n');
  expect(buffersStore.getState().buffers['p\u0000b.js'].content).toBe('port = Number(5000);\n');
  expect(await workspace.readFile('p', 'a.js')).toContain('port = 3000');
  expect(screen.getByText('1 result in 1 file')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('search-input'), '(');
  await wait();
  expect(screen.getByText(/Unterminated group|missing \)/i)).toBeTruthy();
});
