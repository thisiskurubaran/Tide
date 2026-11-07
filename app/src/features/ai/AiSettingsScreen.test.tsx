import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('expo-clipboard', () => ({ getStringAsync: async () => 'sk-pasted' }));
jest.mock('expo-secure-store', () => require('./testMocks').secureStoreMock());
jest.mock('../../state', () => require('./testMocks').stateMock());

import { AiSettingsScreen } from './AiSettingsScreen';
import { AiSetupSheet } from './AiSetupSheet';
import { aiSettings, DEFAULTS } from './settings';
import { fakeFetch, json } from './testMocks';
import { usageStore } from './usage';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  aiSettings.setState({ ...DEFAULTS, hasKey: false });
});

it('lists providers and jobs, edits the limit and completions, and connects a key', async () => {
  aiSettings.setState({ ...DEFAULTS, hasKey: false });
  usageStore.getState().record('anthropic', 'claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 100_000 });
  await render(<AiSettingsScreen />);
  expect(screen.getByText(/Your key stays in the iOS Keychain/)).toBeTruthy();
  expect(screen.getAllByText('Add key ›')).toHaveLength(4);
  expect(screen.getByText('Add server ›')).toBeTruthy();
  expect(screen.getByText('Show inline completions')).toBeTruthy();
  expect(screen.getByTestId('ai-usage-cost').props.children).toBe('$3.00');
  expect(screen.getByText(/\$7\.00 left of your \$10\.00 limit/)).toBeTruthy();

  await act(async () => fireEvent.press(screen.getByTestId('ai-limit-25')));
  expect(aiSettings.getState().monthlyLimitUsd).toBe(25);
  await act(async () => fireEvent.press(screen.getByTestId('ai-limit-none')));
  expect(aiSettings.getState().monthlyLimitUsd).toBeNull();
  await act(async () => fireEvent(screen.getByTestId('ai-completions'), 'valueChange', false));
  expect(aiSettings.getState().completions).toBe(false);

  const f = fakeFetch(() => json({ data: [{ id: 'claude-opus-5-5' }], has_more: false, first_id: null, last_id: null }));
  global.fetch = f.fetch;
  await act(async () => fireEvent.press(screen.getByTestId('ai-provider-anthropic')));
  await act(async () => fireEvent.press(screen.getByTestId('ai-key-paste')));
  await act(async () => fireEvent.press(screen.getByTestId('ai-key-save')));
  expect(f.calls[0].url).toMatch(/api\.anthropic\.com\/v1\/models/);
  expect(screen.getByTestId('ai-key-status')).toBeTruthy();
  expect(aiSettings.getState().connected.anthropic).toBe(true);
  expect(screen.getByTestId('ai-provider-anthropic-connected')).toBeTruthy();
});

it('sets up a provider on first use and says when it is ready', async () => {
  const onReady = jest.fn();
  const onClose = jest.fn();
  global.fetch = fakeFetch(() => json({ data: [{ id: 'gpt-5' }] })).fetch;
  await render(<AiSetupSheet visible onClose={onClose} onReady={onReady} />);
  expect(screen.getByText('Local (Ollama)')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('ai-setup-openai')));
  await act(async () => fireEvent.changeText(screen.getByTestId('ai-setup-key'), 'sk-openai'));
  await act(async () => fireEvent.press(screen.getByTestId('ai-setup-key-save')));
  expect(onReady).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  expect(aiSettings.getState().jobs.chat).toEqual({ provider: 'openai', model: 'gpt-5-mini' });
});

it('says what the limits count, and sets the token limit for models without a price', async () => {
  aiSettings.setState({ ...DEFAULTS, hasKey: false });
  usageStore.getState().record('openai', 'gpt-5', { inputTokens: 400_000, outputTokens: 100_000 });
  await render(<AiSettingsScreen />);
  const counts = screen.getByTestId('ai-limit-counts');
  expect(counts).toHaveTextContent(/dollar limit counts Claude models/);
  expect(counts).toHaveTextContent(/500k tokens this month of 2\.0M/);
  await act(async () => fireEvent.press(screen.getByTestId('ai-token-limit-10000000')));
  expect(aiSettings.getState().unpricedTokenLimit).toBe(10_000_000);
  await act(async () => fireEvent.press(screen.getByTestId('ai-token-limit-none')));
  expect(aiSettings.getState().unpricedTokenLimit).toBeNull();
});

it('resets the agent’s command approvals', async () => {
  const { Alert } = require('react-native');
  const { commandApprovals } = require('../agent/approvalsStore');
  await commandApprovals.setAllowed('web', 'npm', true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Reset')?.onPress?.();
  });
  await render(<AiSettingsScreen />);
  expect(await screen.findByText('1 always allowed')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('ai-reset-approvals')));
  expect(alert).toHaveBeenCalled();
  expect(await commandApprovals.isAllowed('web', 'npm')).toBe(false);
  expect(screen.getByText('No commands are always allowed')).toBeTruthy();
  alert.mockRestore();
});
