// The Git Tools and Debugger screens rendered against a real git repository
// (the built-in CLI on the host's Node) and a fake runner.
/// <reference types="node" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ClientMessage, RunnerMessage, RunRequest } from '@shared/protocol';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-panel-'));
const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/git/cli.js');
const git = (args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoDir,
    env: { ...process.env, TIDE_GIT_NAME: 'Test', TIDE_GIT_EMAIL: 't@example.com', TIDE_GIT_TOKEN: '' },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};
jest.mock('../../features/git/runGit', () => ({
  ...jest.requireActual('../../features/git/runGit'),
  runGit: async (_runner: unknown, _project: string, args: string[]) => git(args),
}));

// The runner the debugger starts programs with.
const sent: ClientMessage[] = [];
let lastRun: { req: RunRequest; reply: (m: RunnerMessage) => void } | null = null;
jest.mock('../../runtime', () => ({
  localRunner: {
    run: (req: RunRequest, reply: (m: RunnerMessage) => void) => {
      lastRun = { req, reply };
    },
    send: (m: ClientMessage) => sent.push(m),
  },
}));
jest.mock('../../state', () => {
  const { createStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', editorFontSize: 14, terminalFontSize: 13 }));
  const { useStore } = jest.requireActual('zustand');
  return {
    useSettings: (selector: (s: unknown) => unknown) => useStore(settings, selector),
    storage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
    buffersStore: createStore(() => ({ buffers: {}, flushProject: async () => undefined, reload: async () => undefined, replace: async () => undefined })),
    projectsStore: createStore(() => ({ loadTree: async () => undefined })),
    tabsStore: createStore(() => ({ byProject: {} })),
    workspace: { readFile: async () => { throw new Error('none'); }, writeFile: async () => undefined },
  };
});
jest.mock('../../state/tabs', () => ({ projectTabs: () => ({ open: [], active: null }) }));

import { breakpointsStore } from '../debugger/breakpoints';
import { debugStore, debuggerExtension } from '../debugger';
import { GitProPanel } from '../gitPro/GitProPanel';
import type { ProjectContext } from '../types';

const ctx: ProjectContext = {
  project: 'p',
  activePath: () => 'main.py',
  cursor: () => null,
  openFile: jest.fn(),
  editor: () => null,
  openPanel: jest.fn(),
  save: async () => undefined,
};

const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));

describe('Git Tools panel', () => {
  beforeAll(() => {
    git(['init']);
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\ntwo\nthree\n');
    git(['add', '-A']);
    git(['commit', '-m', 'first']);
  });

  it('shows changes, stages a hunk from the diff and commits it', async () => {
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\nTWO\nthree\n');
    fs.writeFileSync(path.join(repoDir, 'b.txt'), 'new\n');
    await render(<GitProPanel ctx={ctx} visible onClose={() => undefined} />);
    await settle();
    expect(screen.getByTestId('gp-branch')).toHaveTextContent('main');
    expect(screen.getByTestId('gp-unstaged-a.txt')).toBeTruthy();
    expect(screen.getByTestId('gp-unstaged-b.txt')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('gp-unstaged-a.txt'));
    await settle();
    expect(screen.getByText(/\+ TWO/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('hunk-0-stage'));
    await settle();
    expect(screen.getByText('No unstaged changes in this file.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('gp-back'));
    await settle();
    expect(screen.getByTestId('gp-staged-a.txt')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('gp-message'), 'Shout two');
    await fireEvent.press(screen.getByTestId('gp-commit'));
    await settle();
    expect(git(['log', '--oneline']).stdout).toContain('Shout two');
    expect(screen.queryByTestId('gp-staged-a.txt')).toBeNull();
    expect(screen.getByTestId('gp-unstaged-b.txt')).toBeTruthy();
  });

  it('lists branches and history', async () => {
    await render(<GitProPanel ctx={ctx} visible onClose={() => undefined} />);
    await settle();
    await fireEvent(screen.getByTestId('gp-tab-branches'), 'press');
    await settle();
    expect(screen.getByTestId('gp-branch-main')).toBeTruthy();
    await fireEvent(screen.getByTestId('gp-tab-history'), 'press');
    await settle();
    expect(screen.getByText('Shout two')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
  });
});

describe('Debugger UI', () => {
  const Bar = debuggerExtension.bar!;
  const Panel = debuggerExtension.panels![0].component;

  it('starts the active file and drives the session from the bar', async () => {
    await render(
      <>
        <Bar ctx={ctx} />
        <Panel ctx={ctx} visible onClose={() => undefined} />
      </>,
    );
    expect(screen.queryByTestId('debug-bar')).toBeNull();
    breakpointsStore.getState().set('p', 'main.py', [2]);
    const start = debuggerExtension.commands!(ctx).find((c) => c.id === 'debugger.start')!;
    await act(async () => start.run());
    expect(lastRun!.req).toMatchObject({ runtime: 'python', entry: 'projects/p/main.py', debug: { breakpoints: { 'projects/p/main.py': [2] } } });
    const id = lastRun!.req.id;

    await act(async () =>
      lastRun!.reply({
        type: 'debug',
        id,
        event: { event: 'stopped', reason: 'breakpoint', frames: [{ name: '<module>', file: 'projects/p/main.py', line: 2, column: 1, scopes: [{ name: 'Locals', ref: 1 }] }] },
      }),
    );
    expect(screen.getByText('Paused at main.py:2')).toBeTruthy();
    expect(ctx.openFile).toHaveBeenCalledWith('main.py', 2);
    await act(async () => lastRun!.reply({ type: 'debug', id, event: { event: 'variables', req: 1, variables: [{ name: 'total', value: '42', type: 'int', ref: 0 }] } }));
    expect(screen.getByTestId('var-total')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('debug-step-over'));
    expect(sent).toContainEqual({ type: 'debug', id, command: { cmd: 'stepOver' } });
    await fireEvent.press(screen.getByTestId('debug-stop'));
    expect(sent).toContainEqual({ type: 'kill', id });
    await act(async () => lastRun!.reply({ type: 'exit', id, code: 130, signal: 'SIGINT' }));
    expect(screen.getByText('Finished')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('debug-close'));
    expect(screen.queryByTestId('debug-bar')).toBeNull();
    expect(debugStore.getState().status).toBe('idle');
  });
});
