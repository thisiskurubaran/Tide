import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('../ai/usage', () => ({ costOf: () => 0.012 }));
let mockSetupReady: () => void = () => undefined;
jest.mock('../ai/AiSetupSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    AiSetupSheet: ({ visible, onReady }: { visible: boolean; onReady(): void }) => {
      mockSetupReady = onReady;
      return visible ? <Text testID="ai-setup">Set up AI</Text> : null;
    },
  };
});
let mockReady = true;
const mockChat = jest.fn();
jest.mock('../ai/client', () => {
  const { AiError } = jest.requireActual('../ai/providers/types');
  return { AiError, chat: (req: unknown) => mockChat(req), aiReady: () => mockReady };
});
jest.mock('../ai/settings', () => {
  const { createStore } = jest.requireActual('zustand');
  return { aiSettings: createStore(() => ({ jobs: { chat: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } })) };
});
jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { createStore, useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const buffersStore = createBuffersStore(workspace, 60_000);
  const settings = createStore(() => ({ theme: 'dark' }));
  return { workspace, buffersStore, useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});

import { diagnosticsStore } from '../../extensions/diagnostics';
import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { FixRequest, FixSheet } from './FixSheet';
import { ProblemsPanel } from './ProblemsPanel';

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

const SUM = "import { log } from './log';\nexport const sum = (a, b) => a - b;\nlog(sum(1, 2));\n";
const LOG = 'export const log = (x) => console.log(x)\n';

const REPLY = `<explanation>\`sum\` subtracts; it should use \`+\`.</explanation>
<edit path="src/sum.js"><old>(a, b) => a - b;</old><new>(a, b) => a + b;</new></edit>
<edit path="src/log.js"><old>console.log(x)</old><new>console.log(x);</new></edit>
<edit path="src/sum.js"><old>not there</old><new>x</new></edit>`;

beforeAll(async () => {
  await workspace.createEmptyProject('p');
  await workspace.writeBase64('p', 'src/sum.js', '');
  await workspace.writeBase64('p', 'src/log.js', '');
});

beforeEach(async () => {
  mockReady = true;
  mockChat.mockReset();
  await workspace.writeFile('p', 'src/sum.js', SUM);
  await workspace.writeFile('p', 'src/log.js', LOG);
  buffersStore.setState({ buffers: {} });
  // sum.js is open in the editor; log.js isn't.
  await buffersStore.getState().load('p', 'src/sum.js');
  diagnosticsStore.getState().set('p', 'src/sum.js', 'eslint', [{ from: 0, to: 0, line: 2, column: 1, severity: 'error', message: 'Wrong operator', source: 'eslint' }]);
});

const request: FixRequest = { kind: 'problem', path: 'src/sum.js', line: 2 };

it('shows Thinking, then the explanation, a diff per file and the cost, and applies', async () => {
  let answer: (v: unknown) => void = () => undefined;
  mockChat.mockImplementation(() => new Promise((r) => (answer = r)));
  const onClose = jest.fn();
  await render(<FixSheet project="p" request={request} onClose={onClose} />);
  await settle();
  expect(screen.getByTestId('fix-loading')).toBeTruthy();
  expect(screen.getByText('Thinking…')).toBeTruthy();
  expect(mockChat.mock.calls[0][0].job).toBe('chat');
  // The related file came along.
  expect(mockChat.mock.calls[0][0].messages[0].content).toContain('<related path="src/log.js">');

  await act(async () => answer({ text: REPLY, stop: 'end', usage: { inputTokens: 1500, outputTokens: 300 } }));
  await settle();
  expect(screen.queryByTestId('fix-loading')).toBeNull();
  expect(screen.getByText('✦ Suggested fix')).toBeTruthy();
  expect(screen.getByText(' sum ')).toBeTruthy();
  expect(screen.getByTestId('fix-file-src/sum.js')).toBeTruthy();
  expect(screen.getByTestId('fix-file-src/log.js')).toBeTruthy();
  expect(screen.getAllByTestId('fix-del')).toHaveLength(2);
  expect(screen.getAllByTestId('fix-add')).toHaveLength(2);
  expect(screen.getByTestId('fix-dropped')).toHaveTextContent(/1 suggested edit/);
  expect(screen.getByTestId('fix-cost')).toHaveTextContent('1.8k tokens · about $0.01 · undo with ⌘Z or Local history');

  await fireEvent.press(screen.getByText('Apply 2 changes'));
  await settle();
  // The open file changes in its buffer (so the editor updates, unsaved); the other is written.
  expect(buffersStore.getState().buffers[bufferKey('p', 'src/sum.js')].content).toContain('a + b');
  expect(await workspace.readFile('p', 'src/log.js')).toBe('export const log = (x) => console.log(x);\n');
  expect(onClose).toHaveBeenCalled();
});

it('refuses to apply over a file that changed meanwhile', async () => {
  mockChat.mockResolvedValue({ text: REPLY, stop: 'end', usage: { inputTokens: 10, outputTokens: 10 } });
  const onClose = jest.fn();
  await render(<FixSheet project="p" request={request} onClose={onClose} />);
  await settle();
  buffersStore.getState().edit('p', 'src/sum.js', `${SUM}// typed\n`);
  await fireEvent.press(screen.getByTestId('fix-apply'));
  await settle();
  expect(screen.getByTestId('fix-error')).toHaveTextContent(/changed since/);
  expect(onClose).not.toHaveBeenCalled();
  expect(await workspace.readFile('p', 'src/log.js')).toBe(LOG);
});

it('tries again with the rejected attempt, and explains keeping the edits', async () => {
  mockChat.mockResolvedValue({ text: REPLY, stop: 'end', usage: { inputTokens: 10, outputTokens: 10 } });
  await render(<FixSheet project="p" request={request} onClose={() => undefined} />);
  await settle();
  await fireEvent.press(screen.getByTestId('fix-retry'));
  await settle();
  expect(mockChat.mock.calls[1][0].messages[0].content).toMatch(/rejected/);

  mockChat.mockResolvedValue({ text: '<explanation>The `-` operator subtracts.</explanation>', stop: 'end', usage: { inputTokens: 10, outputTokens: 10 } });
  await fireEvent.press(screen.getByTestId('fix-explain'));
  await settle();
  expect(mockChat.mock.calls[2][0].system).toMatch(/Don't give edits/);
  expect(screen.getByText(' - ')).toBeTruthy();
  expect(screen.getByTestId('fix-apply')).toBeTruthy();
});

it('shows the AI setup sheet when there is no key, and asks once it is set up', async () => {
  mockReady = false;
  await render(<FixSheet project="p" request={request} onClose={() => undefined} />);
  await settle();
  expect(mockChat).not.toHaveBeenCalled();
  expect(screen.getByTestId('ai-setup')).toBeTruthy();
  mockReady = true;
  mockChat.mockResolvedValue({ text: REPLY, stop: 'end', usage: { inputTokens: 10, outputTokens: 10 } });
  await act(async () => mockSetupReady());
  await settle();
  expect(screen.queryByTestId('ai-setup')).toBeNull();
  expect(mockChat).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('fix-apply')).toBeTruthy();
});

it('shows provider errors inline', async () => {
  const { AiError } = jest.requireActual('../ai/providers/types');
  mockChat.mockRejectedValue(new AiError('Monthly limit reached.', 'limit'));
  await render(<FixSheet project="p" request={{ kind: 'file', path: 'src/sum.js' }} onClose={() => undefined} />);
  await settle();
  expect(screen.getByTestId('fix-error')).toHaveTextContent('Monthly limit reached.');
  expect(screen.getByTestId('fix-retry')).toBeTruthy();
});

describe('ProblemsPanel', () => {
  it('has Fix on each problem, Explain & fix on output problems, and Fix all per file', async () => {
    diagnosticsStore.getState().set('p', 'src/sum.js', 'output:t1', [{ from: 0, to: 0, line: 3, column: 1, severity: 'error', message: 'TypeError', source: 'node' }]);
    const onFix = jest.fn();
    const onClose = jest.fn();
    await render(<ProblemsPanel project="p" visible onOpen={() => undefined} onClose={onClose} onExplainError={() => undefined} onFix={onFix} />);
    expect(screen.getByTestId('problem-src/sum.js-2')).toBeTruthy();
    expect(screen.getByTestId('problems-explain')).toBeTruthy();
    expect(screen.getByTestId('problem-fix-src/sum.js-2')).toHaveTextContent('✦ Fix');
    expect(screen.getByTestId('problem-fix-src/sum.js-3')).toHaveTextContent('✦ Explain & fix');
    await fireEvent.press(screen.getByTestId('problem-fix-src/sum.js-2'));
    expect(onFix).toHaveBeenLastCalledWith({ kind: 'problem', path: 'src/sum.js', line: 2 });
    await fireEvent.press(screen.getByTestId('problem-fix-file-src/sum.js'));
    expect(onFix).toHaveBeenLastCalledWith({ kind: 'file', path: 'src/sum.js' });
    expect(onClose).toHaveBeenCalled();
    diagnosticsStore.getState().clearSource('output:t1');
  });

  it('opens its own Fix sheet without onFix', async () => {
    mockChat.mockResolvedValue({ text: REPLY, stop: 'end', usage: { inputTokens: 10, outputTokens: 10 } });
    await render(<ProblemsPanel project="p" visible onOpen={() => undefined} onClose={() => undefined} />);
    await fireEvent.press(screen.getByTestId('problem-fix-src/sum.js-2'));
    await settle();
    expect(screen.getByTestId('fix-sheet')).toBeTruthy();
    expect(screen.getByTestId('fix-apply')).toBeTruthy();
  });
});
