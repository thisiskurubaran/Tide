import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
const mockRuns: { entry: string; args: string[] }[] = [];
jest.mock('../../runtime', () => ({
  localRunner: {
    run: (req: { id: string; entry: string; args: string[] }, onMessage: (m: unknown) => void) => {
      mockRuns.push({ entry: req.entry, args: req.args });
      setTimeout(() => {
        onMessage({ type: 'stdout', id: req.id, data: 'added 1 package in 0.1s\n' });
        onMessage({ type: 'exit', id: req.id, code: 0 });
      }, 0);
    },
    send: () => undefined,
  },
}));
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createStore, useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const runnerStore = createStore(() => ({ mode: 'local' }));
  const settings = createStore(() => ({ theme: 'dark' }));
  return {
    useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel),
    workspace,
    runnerStore,
    projectsStore: createStore(() => ({ loadTree: async () => undefined })),
    buffersStore: createStore(() => ({ flushProject: async () => undefined, reloadProject: async () => undefined })),
    useRunner: (sel: (s: unknown) => unknown) => useStore(runnerStore, sel),
  };
});

import { runnerStore, workspace } from '../../state';
import { PackagesSheet } from './PackagesSheet';

const settle = () => act(() => new Promise((r) => setTimeout(r, 400)));

beforeAll(async () => {
  await workspace.createEmptyProject('p');
  await workspace.writeBase64('p', 'package.json', Buffer.from(JSON.stringify({ dependencies: { lodash: '^4.0.0' } })).toString('base64'));
  await workspace.writeBase64('p', 'node_modules/lodash/package.json', Buffer.from('{"version":"4.0.0"}').toString('base64'));
  global.fetch = jest.fn(async (url: string) => {
    const body = url.includes('/-/v1/search')
      ? { objects: [{ package: { name: 'left-pad', version: '1.3.0', description: 'String left pad' } }] }
      : url.endsWith('/lodash/latest')
        ? { version: '4.17.21' }
        : null;
    return { ok: body !== null, status: body ? 200 : 404, json: async () => body };
  }) as unknown as typeof fetch;
});

beforeEach(() => {
  mockRuns.length = 0;
});

it('lists dependencies, offers updates and installs from search', async () => {
  await render(<PackagesSheet project="p" visible onClose={() => undefined} onTerminal={() => undefined} />);
  await settle();
  expect(screen.getByText(/4\.0\.0/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('update-lodash'));
  await settle();
  expect(mockRuns).toEqual([{ entry: 'tide:npm', args: ['install', 'lodash@latest'] }]);

  await fireEvent.changeText(screen.getByTestId('packages-search'), 'left pad');
  await settle();
  expect(screen.getByText('String left pad')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('install-left-pad'));
  await settle();
  expect(mockRuns[1]).toEqual({ entry: 'tide:npm', args: ['install', 'left-pad'] });
});

it('sends commands to the terminal in remote mode', async () => {
  runnerStore.setState({ mode: 'remote' });
  const onTerminal = jest.fn();
  await render(<PackagesSheet project="p" visible onClose={() => undefined} onTerminal={onTerminal} />);
  await settle();
  await fireEvent.press(screen.getByTestId('update-lodash'));
  expect(onTerminal).toHaveBeenCalledWith('npm install lodash@latest');
  expect(mockRuns).toEqual([]);
});
