import { createMemoryFs } from '../features/files/memoryFs';
import { createWorkspace } from '../features/files/workspace';
import { createBuffersStore } from './buffers';
import { createProjectsStore } from './projects';
import { createRunnerStore } from './runner';
import { hydrated } from './hydrated';
import { createFsStorage } from './storage';
import { createTabsStore, projectTabs } from './tabs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const fs = createMemoryFs();
  const storage = createFsStorage(fs);
  const tabs = createTabsStore(storage);
  const workspace = createWorkspace(fs);
  const buffers = createBuffersStore(workspace);
  const projects = createProjectsStore(workspace, tabs, buffers);
  return { fs, storage, tabs, buffers, projects };
}

describe('tabs store', () => {
  it('opens each file once and focuses it', () => {
    const { tabs } = setup();
    const t = tabs.getState();
    t.openTab('p', 'a.js');
    t.openTab('p', 'b.js');
    t.openTab('p', 'a.js');
    expect(projectTabs(tabs.getState(), 'p')).toEqual({ open: ['a.js', 'b.js'], active: 'a.js' });
  });

  it('focuses the neighbour when the active tab closes', () => {
    const { tabs } = setup();
    const t = tabs.getState();
    ['a', 'b', 'c'].forEach((p) => t.openTab('p', p));
    t.openTab('p', 'b');
    t.closeTab('p', 'b');
    expect(projectTabs(tabs.getState(), 'p')).toEqual({ open: ['a', 'c'], active: 'c' });
    t.closeTab('p', 'c');
    expect(projectTabs(tabs.getState(), 'p').active).toBe('a');
    t.closeTab('p', 'a');
    expect(projectTabs(tabs.getState(), 'p')).toEqual({ open: [], active: null });
  });

  it('follows folder renames and drops tabs under deleted folders', () => {
    const { tabs } = setup();
    const t = tabs.getState();
    ['src/a.js', 'src/lib/b.js', 'srcx.js'].forEach((p) => t.openTab('p', p));
    t.renamePath('p', 'src', 'app');
    expect(projectTabs(tabs.getState(), 'p')).toEqual({ open: ['app/a.js', 'app/lib/b.js', 'srcx.js'], active: 'srcx.js' });
    t.openTab('p', 'app/lib/b.js');
    t.removePath('p', 'app/lib');
    expect(projectTabs(tabs.getState(), 'p')).toEqual({ open: ['app/a.js', 'srcx.js'], active: 'app/a.js' });
  });

  it('survives a restart', async () => {
    const { tabs, storage } = setup();
    await hydrated(tabs);
    tabs.getState().openTab('p', 'index.js');
    tabs.getState().setLastProject('p');
    await flush();

    const restarted = createTabsStore(storage);
    await restarted.persist.rehydrate();
    expect(restarted.getState().lastProject).toBe('p');
    expect(restarted.getState().recent).toEqual(['p']);
    expect(projectTabs(restarted.getState(), 'p')).toEqual({ open: ['index.js'], active: 'index.js' });
  });
});

describe('runner store', () => {
  it('defaults to local and persists the mode', async () => {
    const { storage } = setup();
    const runner = createRunnerStore(storage);
    await hydrated(runner);
    expect(runner.getState().mode).toBe('local');
    runner.getState().setMode('remote');
    await flush();
    const restarted = createRunnerStore(storage);
    await restarted.persist.rehydrate();
    expect(restarted.getState().mode).toBe('remote');
  });
});

describe('projects store', () => {
  it('lists projects from disk and keeps state files out of the projects folder', async () => {
    const { projects, tabs, fs } = setup();
    await projects.getState().createProject('demo', 'node-hello');
    tabs.getState().openTab('demo', 'index.js');
    await flush();
    expect(projects.getState().projects).toEqual(['demo']);
    expect(fs.files.has('.tide/tabs.json')).toBe(true);
  });

  it('opens a new file and keeps tabs in sync with tree changes', async () => {
    const { projects, tabs } = setup();
    const p = projects.getState();
    await p.createProject('demo', 'node-hello');
    await p.loadTree('demo');
    await p.createFolder('demo', '', 'src');
    await p.createFile('demo', 'src', 'app.js');
    expect(projectTabs(tabs.getState(), 'demo').active).toBe('src/app.js');

    await p.renameEntry('demo', 'src', 'lib');
    expect(projectTabs(tabs.getState(), 'demo').open).toEqual(['lib/app.js']);
    expect(projects.getState().trees.demo.map((n) => n.name)).toContain('lib');

    await p.deleteEntry('demo', 'lib');
    expect(projectTabs(tabs.getState(), 'demo').open).toEqual([]);
  });

  it('moves tabs and the tree with a renamed project and clears them on delete', async () => {
    const { projects, tabs } = setup();
    const p = projects.getState();
    await p.createProject('demo', 'node-hello');
    await p.loadTree('demo');
    tabs.getState().openTab('demo', 'index.js');
    tabs.getState().setLastProject('demo');

    await p.renameProject('demo', 'hello');
    expect(projects.getState().projects).toEqual(['hello']);
    expect(Object.keys(projects.getState().trees)).toEqual(['hello']);
    expect(tabs.getState().lastProject).toBe('hello');
    expect(tabs.getState().recent).toEqual(['hello']);
    expect(projectTabs(tabs.getState(), 'hello').open).toEqual(['index.js']);

    await p.deleteProject('hello');
    expect(projects.getState().projects).toEqual([]);
    expect(tabs.getState().byProject).toEqual({});
    expect(tabs.getState().lastProject).toBeNull();
    expect(tabs.getState().recent).toEqual([]);
  });

  it('keeps recent projects in order without repeats', () => {
    const { tabs } = setup();
    const t = tabs.getState();
    ['a', 'b', 'a', 'c'].forEach((p) => t.setLastProject(p));
    t.setLastProject(null);
    expect(tabs.getState().recent).toEqual(['c', 'a', 'b']);
  });
});

describe('tree changes and open files', () => {
  it('keeps the tab and its typing when a delete fails', async () => {
    const { fs, tabs, buffers, projects } = setup();
    const workspace = createWorkspace(fs);
    await projects.getState().createProject('p', 'node-hello');
    await buffers.getState().load('p', 'index.js');
    tabs.getState().openTab('p', 'index.js');
    const failing = createProjectsStore({ ...workspace, deleteEntry: async () => Promise.reject(new Error('EACCES')) }, tabs, buffers);
    await expect(failing.getState().deleteEntry('p', 'index.js')).rejects.toThrow('EACCES');
    expect(projectTabs(tabs.getState(), 'p').open).toEqual(['index.js']);
    buffers.getState().edit('p', 'index.js', 'still saved');
    await buffers.getState().flushAll();
    expect(await workspace.readFile('p', 'index.js')).toBe('still saved');
  });

  it('tells history about renames, moves and deletes, and new files at old paths', async () => {
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    const tabs = createTabsStore(createFsStorage(fs));
    const buffers = createBuffersStore(workspace);
    const pathRenamed = jest.fn(async () => undefined);
    const pathRemoved = jest.fn(async () => undefined);
    const projects = createProjectsStore(workspace, tabs, buffers, { pathRenamed, pathRemoved });
    await projects.getState().createProject('p', 'node-hello');
    await projects.getState().renameEntry('p', 'index.js', 'main.js');
    expect(pathRenamed).toHaveBeenCalledWith('p', 'index.js', 'main.js');
    await projects.getState().createFolder('p', '', 'src');
    await projects.getState().moveEntry('p', 'main.js', 'src/main.js');
    expect(pathRenamed).toHaveBeenCalledWith('p', 'main.js', 'src/main.js');
    await projects.getState().deleteEntry('p', 'src/main.js');
    expect(pathRemoved).toHaveBeenCalledWith('p', 'src/main.js');
    await projects.getState().createFile('p', 'src', 'main.js');
    expect(pathRemoved).toHaveBeenCalledTimes(2);
  });

  it("keeps a renamed file's tab even if a reload runs mid-rename", async () => {
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    const tabs = createTabsStore(createFsStorage(fs));
    const buffers = createBuffersStore(workspace, 800, { gone: (project, path) => tabs.getState().removePath(project, path) });
    // A reload (e.g. after a run) lands between the rename on disk and the tabs following it.
    const realRename = workspace.renameEntry.bind(workspace);
    const projects = createProjectsStore(
      {
        ...workspace,
        renameEntry: async (project: string, path: string, name: string) => {
          const to = await realRename(project, path, name);
          await buffers.getState().reload(project, path);
          return to;
        },
      },
      tabs,
      buffers,
    );
    await projects.getState().createProject('p', 'node-hello');
    await buffers.getState().load('p', 'index.js');
    tabs.getState().openTab('p', 'index.js');
    await projects.getState().renameEntry('p', 'index.js', 'main.js');
    expect(projectTabs(tabs.getState(), 'p').open).toEqual(['main.js']);
    expect(buffers.getState().buffers['p\u0000main.js']).toBeDefined();
  });
});

describe('cloneProject', () => {
  it('keeps the project when the clone works and removes it when it fails', async () => {
    const { projects, fs } = setup();
    const ok = await projects.getState().cloneProject('repo', async (p) => {
      fs.files.set(`projects/${p}/README.md`, 'hi');
    });
    expect(ok).toBe('repo');
    expect(projects.getState().projects).toContain('repo');
    await expect(
      projects.getState().cloneProject('broken', async () => {
        throw new Error('repository not found');
      }),
    ).rejects.toThrow('repository not found');
    expect(fs.dirs.has('projects/broken')).toBe(false);
  });
});
