// Start-up waits for every saved store, recents included, before showing a screen.
import { act, render } from '@testing-library/react-native';

const mockWaited: unknown[] = [];
jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('./hydrated', () => ({
  hydrated: (store: unknown) => {
    mockWaited.push(store);
    return Promise.resolve();
  },
  allLoaded: (tasks: Promise<unknown>[]) => Promise.all(tasks).then(() => undefined),
}));
const store = (name: string) => ({ name, getState: () => ({ load: async () => undefined, refresh: async () => undefined }) });
jest.mock('.', () => ({
  projectsStore: store('projects'),
  recentsStore: store('recents'),
  runnerStore: store('runner'),
  settingsStore: store('settings'),
  tabsStore: store('tabs'),
  useSettings: () => 'system',
}));
jest.mock('../extensions/debugger/breakpoints', () => ({ breakpointsStore: {} }));
jest.mock('../extensions/state', () => ({ extensionsStore: {} }));
jest.mock('../features/history', () => ({}));
jest.mock('../features/agent/changesStore', () => ({ changesStore: {} }));
jest.mock('../features/git/settings', () => ({ gitSettingsStore: { getState: () => ({ load: async () => undefined }) } }));
jest.mock('../features/hosts/accounts', () => ({ accountsStore: { getState: () => ({ load: async () => undefined }) } }));
jest.mock('../features/widgets', () => ({ startWidgets: jest.fn() }));
jest.mock('../features/external', () => ({ linkedStore: {} }));
jest.mock('../features/keybar/store', () => ({ keyBarStore: {} }));
jest.mock('../features/launch/quickActions', () => ({ startQuickActions: jest.fn() }));
jest.mock('../features/privacy/crashReports', () => ({ startCrashReports: jest.fn() }));
jest.mock('../features/remote/settings', () => ({ remoteSettingsStore: { getState: () => ({ load: async () => undefined }) } }));
jest.mock('../theme/theme', () => ({ useChromeTheme: () => null, useColors: () => ({ background: '#000' }) }));
jest.mock('../features/support/logs', () => ({ captureConsole: jest.fn() }));
jest.mock('../features/support/store', () => ({ supportStore: {} }));
jest.mock('../runtime/wasm', () => ({ WasmHost: () => null }));
jest.mock('../extensions/formatLint/RuffHost', () => ({ RuffHost: () => null }));

import RootLayout from '../app/_layout';
import { recentsStore } from '.';

it('waits for the recents store to load at start-up', async () => {
  await render(<RootLayout />);
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(mockWaited).toContain(recentsStore);
});
