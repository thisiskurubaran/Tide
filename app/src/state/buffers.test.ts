import { createMemoryFs } from '../features/files/memoryFs';
import { createWorkspace } from '../features/files/workspace';
import { AUTOSAVE_MS, bufferKey, createBuffersStore, isDirty } from './buffers';
import { createProjectsStore } from './projects';
import { createFsStorage } from './storage';
import { createTabsStore } from './tabs';

async function setup() {
  const fs = createMemoryFs();
  const workspace = createWorkspace(fs);
  await workspace.createProject('p', 'node-hello');
  const buffers = createBuffersStore(workspace);
  const projects = createProjectsStore(workspace, createTabsStore(createFsStorage(fs)), buffers);
  return { fs, workspace, buffers, projects };
}

const buf = (store: Awaited<ReturnType<typeof setup>>['buffers'], path: string, project = 'p') =>
  store.getState().buffers[bufferKey(project, path)];

// Let pending promises (the async write) settle under fake timers.
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('buffers store', () => {
  it('loads from disk once and keeps the buffer', async () => {
    const { buffers, workspace } = await setup();
    const first = await buffers.getState().load('p', 'index.js');
    expect(first.content).toContain('Hello');
    await workspace.writeFile('p', 'index.js', 'changed on disk');
    await expect(buffers.getState().load('p', 'index.js')).resolves.toBe(first);
  });

  it('marks edits dirty and autosaves after the debounce', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'a');
    jest.advanceTimersByTime(AUTOSAVE_MS / 2);
    buffers.getState().edit('p', 'index.js', 'ab');
    expect(isDirty(buf(buffers, 'index.js'))).toBe(true);

    jest.advanceTimersByTime(AUTOSAVE_MS - 1);
    await settle();
    expect(await workspace.readFile('p', 'index.js')).toContain('Hello');

    jest.advanceTimersByTime(1);
    await settle();
    expect(await workspace.readFile('p', 'index.js')).toBe('ab');
    expect(isDirty(buf(buffers, 'index.js'))).toBe(false);
  });

  it('is clean again when edits return to the saved text', async () => {
    const { buffers } = await setup();
    const { content } = await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'x');
    buffers.getState().edit('p', 'index.js', content);
    expect(isDirty(buf(buffers, 'index.js'))).toBe(false);
  });

  it('saves immediately on demand and on flush', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    await buffers.getState().load('p', 'tide.json');
    buffers.getState().edit('p', 'index.js', 'one');
    await buffers.getState().save('p', 'index.js');
    expect(await workspace.readFile('p', 'index.js')).toBe('one');

    buffers.getState().edit('p', 'tide.json', '{}');
    await buffers.getState().flushAll();
    expect(await workspace.readFile('p', 'tide.json')).toBe('{}');
    // The timer was cancelled by the flush, so nothing is written twice.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps typing that happens while a save is in flight dirty', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'first');
    const saving = buffers.getState().save('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'second');
    await saving;
    expect(buf(buffers, 'index.js')).toEqual({ content: 'second', saved: 'first' });
    expect(await workspace.readFile('p', 'index.js')).toBe('first');
  });
});

describe('buffers with tree changes', () => {
  it('flushes before a folder rename so no write lands on the old path', async () => {
    const { buffers, projects, fs } = await setup();
    await projects.getState().createFolder('p', '', 'src');
    await projects.getState().createFile('p', 'src', 'a.js');
    await buffers.getState().load('p', 'src/a.js');
    buffers.getState().edit('p', 'src/a.js', 'edited');

    await projects.getState().renameEntry('p', 'src', 'lib');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();

    expect(fs.files.get('projects/p/lib/a.js')).toBe('edited');
    expect(fs.files.has('projects/p/src/a.js')).toBe(false);
    expect(buf(buffers, 'lib/a.js')).toEqual({ content: 'edited', saved: 'edited' });
  });

  it('drops pending saves for deleted files', async () => {
    const { buffers, projects, fs } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'doomed');
    await projects.getState().deleteEntry('p', 'index.js');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();
    expect(fs.files.has('projects/p/index.js')).toBe(false);
    expect(buf(buffers, 'index.js')).toBeUndefined();
  });

  it('moves buffers with a renamed project', async () => {
    const { buffers, projects, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'kept');
    await projects.getState().renameProject('p', 'q');
    await expect(workspace.readFile('q', 'index.js')).resolves.toBe('kept');
    expect(buf(buffers, 'index.js', 'q')?.content).toBe('kept');
    expect(buf(buffers, 'index.js', 'p')).toBeUndefined();
  });
});

describe('buffers with moves and copies', () => {
  it('moves tabs and buffers with a file moved to another folder', async () => {
    const { buffers, projects, fs } = await setup();
    await projects.getState().createFolder('p', '', 'lib');
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'moved edit');
    await projects.getState().moveEntry('p', 'index.js', 'lib/index.js');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();
    expect(fs.files.get('projects/p/lib/index.js')).toBe('moved edit');
    expect(fs.files.has('projects/p/index.js')).toBe(false);
    expect(buf(buffers, 'lib/index.js')?.content).toBe('moved edit');
  });

  it('copies the unsaved editor contents', async () => {
    const { buffers, projects, fs } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'latest');
    await projects.getState().copyEntry('p', 'index.js', 'copy.js');
    expect(fs.files.get('projects/p/copy.js')).toBe('latest');
  });
});
