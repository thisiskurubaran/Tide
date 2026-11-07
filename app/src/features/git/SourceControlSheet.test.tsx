import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('./settings', () => ({ gitEnv: () => ({}) }));
jest.mock('../deploy', () => ({ autoDeployer: { onCommit: async () => undefined } }));
jest.mock('../ai/SuggestMessageButton', () => ({ SuggestMessageButton: () => null }));
const mockRuns: string[][] = [];
jest.mock('../../runtime', () => ({
  localRunner: {
    run: (req: { id: string; args: string[] }, onMessage: (m: unknown) => void) => {
      mockRuns.push(req.args);
      const out = req.args[0] === 'status' ? ' M index.js\n' : req.args[0] === 'branch' ? '* main\n' : 'Already up to date.\n';
      setTimeout(() => {
        onMessage({ type: 'stdout', id: req.id, data: out });
        onMessage({ type: 'exit', id: req.id, code: 0 });
      }, 0);
    },
    send: () => undefined,
  },
}));
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark' }));
  return {
    useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel),
    projectsStore: createStore(() => ({ loadTree: async () => undefined })),
    buffersStore: createStore(() => ({ flushProject: async () => undefined, reloadProject: async () => undefined })),
  };
});

import { buffersStore } from '../../state';
import { SourceControlSheet } from './SourceControlSheet';

const settle = () => act(() => new Promise((r) => setTimeout(r, 200)));
const pull = () =>
  act(async () => {
    fireEvent.press(screen.getByTestId('sc-pull'));
    await new Promise((r) => setTimeout(r, 200));
  });

it('clears busy and shows the error when saving open files fails (L3)', async () => {
  const flushProject = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  buffersStore.setState({ flushProject });
  await render(<SourceControlSheet project="p" visible onClose={() => undefined} />);
  await settle();
  mockRuns.length = 0;
  await pull();
  // Git doesn't run over unsaved files, and the error is shown.
  expect(mockRuns.filter((a) => a[0] === 'pull')).toEqual([]);
  expect(screen.getByTestId('sc-output').props.children).toMatch(/disk full/);
  // Not stuck busy: the button reads "Pull" again and the next press runs.
  expect(screen.getByText('Pull')).toBeTruthy();
  await pull();
  expect(mockRuns.filter((a) => a[0] === 'pull')).toEqual([['pull']]);
});
