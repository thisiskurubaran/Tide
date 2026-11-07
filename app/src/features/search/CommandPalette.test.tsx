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

import { workspace } from '../../state';
import { Command, CommandPalette } from './CommandPalette';

const wait = (ms = 300) => act(async () => new Promise((r) => setTimeout(r, ms)));

beforeAll(async () => {
  await workspace.createProject('p', 'node-hello');
  await workspace.createFolder('p', '', 'src');
  await workspace.createFile('p', 'src', 'app.js', 'function main() {\n  return port;\n}\nclass Server {}\n');
  await workspace.createFile('p', '', 'README.md', '# Hello\n');
});

async function setup(props: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const ran: string[] = [];
  const commands: Command[] = ['save', 'format', 'run'].map((id) => ({ id, title: `${id[0].toUpperCase()}${id.slice(1)} file`, icon: 'file', run: () => ran.push(id) }));
  const onOpenFile = jest.fn();
  const onOpenAt = jest.fn();
  const onClose = jest.fn();
  const utils = await render(<CommandPalette mode="files" project="p" commands={commands} onOpenFile={onOpenFile} onOpenAt={onOpenAt} onClose={onClose} {...props} />);
  return { ...utils, ran, onOpenFile, onOpenAt, onClose };
}

it('opens files with no prefix and runs commands after ">"', async () => {
  const { ran, onOpenFile } = await setup();
  await wait(0);
  await fireEvent.changeText(screen.getByTestId('palette-input'), 'app');
  await fireEvent(screen.getByTestId('palette-input'), 'submitEditing');
  expect(onOpenFile).toHaveBeenCalledWith('src/app.js');

  await fireEvent.changeText(screen.getByTestId('palette-input'), '>fmt');
  expect(screen.getByText('COMMANDS')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('palette-command-format'));
  expect(ran).toEqual(['format']);

  // Just ">" lists recently run commands first.
  await fireEvent.changeText(screen.getByTestId('palette-input'), '>');
  expect(screen.getByText('RECENT')).toBeTruthy();
  await fireEvent(screen.getByTestId('palette-input'), 'submitEditing');
  expect(ran).toEqual(['format', 'format']);
});

it('moves the selection with arrow keys', async () => {
  const { ran } = await setup({ mode: 'commands' });
  await wait(0);
  await fireEvent.changeText(screen.getByTestId('palette-input'), '> file');
  await fireEvent(screen.getByTestId('palette-input'), 'keyPress', { nativeEvent: { key: 'ArrowDown' } });
  expect(screen.getAllByRole('button', { selected: true }).some((b) => b.props.testID?.startsWith('palette-command-'))).toBe(true);
  await fireEvent(screen.getByTestId('palette-input'), 'submitEditing');
  expect(ran).toHaveLength(1);
});

it('switches prefix with the chips', async () => {
  await setup({ mode: 'commands' });
  await wait(0);
  expect(screen.getByTestId('palette-input').props.value).toBe('>');
  await fireEvent.press(screen.getByTestId('palette-prefix-line'));
  expect(screen.getByTestId('palette-input').props.value).toBe(':');
  expect(screen.getByText('Open a file first')).toBeTruthy();
});

it('goes to a symbol or a line in the active file', async () => {
  const { onOpenAt } = await setup({ activePath: 'src/app.js' });
  await fireEvent.changeText(screen.getByTestId('palette-input'), '@serv');
  await wait(0);
  await fireEvent.press(screen.getByTestId('palette-symbol-Server'));
  expect(onOpenAt).toHaveBeenLastCalledWith('src/app.js', 4, undefined);

  await fireEvent.changeText(screen.getByTestId('palette-input'), ':2:5');
  expect(screen.getByText('Go to line 2, column 5')).toBeTruthy();
  await fireEvent(screen.getByTestId('palette-input'), 'submitEditing');
  expect(onOpenAt).toHaveBeenLastCalledWith('src/app.js', 2, 5);
});

it('searches text across the project after "#"', async () => {
  const { onOpenAt } = await setup();
  await fireEvent.changeText(screen.getByTestId('palette-input'), '#port');
  await wait();
  await fireEvent.press(screen.getByTestId('palette-match-src/app.js:2'));
  expect(onOpenAt).toHaveBeenCalledWith('src/app.js', 2, undefined);
});
