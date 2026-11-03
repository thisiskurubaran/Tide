// The home screen with the stores seeded: cards, search, recent files and tools.
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    router: { back: jest.fn(), push: jest.fn() },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../git/clone', () => ({ cloneRepo: jest.fn() }));
jest.mock('../../git/status', () => {
  const { createStore, useStore } = require('zustand');
  const gitStatusStore = createStore(() => ({ byProject: {}, refresh: jest.fn(() => Promise.resolve()) }));
  return { gitStatusStore, useGitStatus: (sel: (s: unknown) => unknown) => useStore(gitStatusStore, sel) };
});

import { router } from 'expo-router';

import { buffersStore, projectsStore, recentsStore, workspace } from '../../../state';
import { bufferKey } from '../../../state/buffers';
import { supportStore } from '../../support/store';
import { gitStatusStore } from '../../git/status';
import { ProjectsScreen } from '../ProjectsScreen';

const push = router.push as jest.Mock;

beforeEach(() => {
  push.mockClear();
  supportStore.setState({ onboarded: true });
  jest.spyOn(workspace, 'listFiles').mockImplementation(async (p) => (p === 'site' ? ['index.html', 'style.css', 'app.js'] : ['src/index.ts']));
  projectsStore.setState({ projects: ['api', 'site'] });
  recentsStore.setState({
    projects: { site: Date.now() - 2 * 60_000 },
    files: [
      { project: 'site', path: 'index.html', at: Date.now() },
      { project: 'api', path: 'src/index.ts', at: Date.now() - 1000 },
      { project: 'gone', path: 'x.js', at: Date.now() - 2000 },
    ],
  });
  gitStatusStore.setState({ byProject: { site: { branch: 'main', changes: { 'a.js': ' M', 'b.js': '??' } } } });
  buffersStore.setState({ buffers: { [bufferKey('api', 'src/index.ts')]: { content: 'x', saved: '' } } });
});

describe('Projects screen', () => {
  it('shows cards sorted by last opened with git, unsaved and language info', async () => {
    await render(<ProjectsScreen />);
    const cards = screen.getAllByTestId(/^project-(api|site)$/).map((c) => c.props.testID);
    expect(cards).toEqual(['project-site', 'project-api']);
    expect(await screen.findByText('HTML · CSS · JS')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('2 changed')).toBeTruthy();
    expect(screen.getByText('2 min ago')).toBeTruthy();
    expect(screen.getByText('1 unsaved')).toBeTruthy();
    expect(gitStatusStore.getState().refresh).toHaveBeenCalledWith('site');

    await fireEvent.press(screen.getByTestId('project-api'));
    expect(push).toHaveBeenCalledWith('/project/api');
  });

  it('lists recent files of existing projects and opens one', async () => {
    await render(<ProjectsScreen />);
    expect(screen.queryByTestId('recent-file-gone/x.js')).toBeNull();
    await fireEvent.press(screen.getByTestId('recent-file-api/src/index.ts'));
    expect(push).toHaveBeenCalledWith('/project/api?file=src%2Findex.ts');
  });

  it('filters projects and files as you type', async () => {
    await render(<ProjectsScreen />);
    await fireEvent.changeText(screen.getByTestId('projects-search'), 'sit');
    expect(screen.queryByTestId('project-api')).toBeNull();
    expect(screen.getByTestId('project-site')).toBeTruthy();
    expect(screen.queryByTestId('recent-file-api/src/index.ts')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('projects-search'), 'zzz');
    expect(screen.getByText('No projects match "zzz"')).toBeTruthy();
  });

  it('keeps the tools and the empty state actions', async () => {
    projectsStore.setState({ projects: [] });
    await render(<ProjectsScreen />);
    expect(screen.getByText('Write and run code anywhere')).toBeTruthy();
    expect(screen.getByText('Portfolio website')).toBeTruthy();
    expect(screen.getByTestId('empty-open-folder')).toBeTruthy();
    expect(screen.getByTestId('new-project')).toBeTruthy();
    expect(screen.getByTestId('clone-repo')).toBeTruthy();
    for (const id of ['open-github', 'open-ssh', 'open-databases', 'open-tools', 'open-docs', 'open-extensions']) expect(screen.getByTestId(id)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('open-ssh'));
    expect(push).toHaveBeenCalledWith('/ssh');
  });

  it('creates and opens a sample project from the empty state, ', async () => {
    projectsStore.setState({ projects: [] });
    const create = jest.fn(async (name: string) => name);
    const original = projectsStore.getState().createProject;
    projectsStore.setState({ createProject: create });
    try {
      await render(<ProjectsScreen />);
      await fireEvent.press(screen.getByTestId('sample-static-site'));
      expect(create).toHaveBeenCalledWith('portfolio', 'static-site');
      expect(push).toHaveBeenCalledWith('/project/portfolio');
    } finally {
      projectsStore.setState({ createProject: original });
    }
  });

  it('opens the clone sheet from the empty state', async () => {
    projectsStore.setState({ projects: [] });
    await render(<ProjectsScreen />);
    await fireEvent.press(screen.getByTestId('empty-clone'));
    expect(screen.getByText('Clone repository')).toBeTruthy();
  });

  it('opens the sheet in clone mode from Clone repo', async () => {
    await render(<ProjectsScreen />);
    await fireEvent.press(screen.getByTestId('clone-repo'));
    expect(screen.getByText('Clone repository')).toBeTruthy();
    expect(screen.getByTestId('clone-url')).toBeTruthy();
  });
});
