import { createMemoryFs } from '../features/files/memoryFs';
import { createWorkspace } from '../features/files/workspace';
import { AUTOSAVE_MS, bufferKey, createBuffersStore, DROP_GRACE_MS, isDirty } from './buffers';
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
  it('keeps the buffer while the disk is unchanged', async () => {
    const { buffers } = await setup();
    const first = await buffers.getState().load('p', 'index.js');
    expect(first.content).toContain('Hello');
    await expect(buffers.getState().load('p', 'index.js')).resolves.toBe(first);
  });

  it('rereads a clean buffer that changed on disk when loaded again', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    await workspace.writeFile('p', 'index.js', 'changed on disk');
    expect((await buffers.getState().load('p', 'index.js')).content).toBe('changed on disk');
  });

  it('keeps unsaved edits over the disk when loaded again', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'mine');
    await workspace.writeFile('p', 'index.js', 'theirs');
    expect((await buffers.getState().load('p', 'index.js')).content).toBe('mine');
  });

  it('reloadProject rereads every clean buffer of the project, and only that project', async () => {
    const { buffers, workspace } = await setup();
    await workspace.createProject('q', 'node-hello');
    await buffers.getState().load('p', 'index.js');
    await buffers.getState().load('p', 'tide.json');
    await buffers.getState().load('q', 'index.js');
    buffers.getState().edit('p', 'tide.json', 'unsaved');
    await workspace.writeFile('p', 'index.js', 'pulled');
    await workspace.writeFile('p', 'tide.json', 'pulled');
    await workspace.writeFile('q', 'index.js', 'other');
    await buffers.getState().reloadProject('p');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'pulled', saved: 'pulled' });
    expect(buf(buffers, 'tide.json').content).toBe('unsaved');
    expect(buf(buffers, 'index.js', 'q').content).toContain('Hello');
    // The next autosave no longer writes the old text back.
    await buffers.getState().flushProject('p');
    expect(await workspace.readFile('p', 'index.js')).toBe('pulled');
  });

  it('drop forgets clean buffers but keeps dirty ones', async () => {
    const { buffers } = await setup();
    await buffers.getState().load('p', 'index.js');
    await buffers.getState().load('p', 'tide.json');
    buffers.getState().edit('p', 'tide.json', 'unsaved');
    buffers.getState().drop('p', 'index.js');
    buffers.getState().drop('p', 'tide.json');
    expect(buf(buffers, 'index.js')).toBeUndefined();
    expect(buf(buffers, 'tide.json').content).toBe('unsaved');
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

describe('rename onto a buffer that is still open', () => {
  it("doesn't clobber the buffer already at the destination: its edits are recovered", async () => {
    const { buffers, workspace } = await setup();
    await workspace.createFile('p', '', 'b.js', 'b on disk');
    await buffers.getState().load('p', 'b.js');
    buffers.getState().edit('p', 'b.js', 'b edits');
    await workspace.deleteEntry('p', 'b.js');
    await buffers.getState().reload('p', 'b.js');
    await buffers.getState().load('p', 'index.js');
    await workspace.renameEntry('p', 'index.js', 'b.js');
    buffers.getState().renamePath('p', 'index.js', 'b.js');
    await settle();
    await jest.runAllTimersAsync();
    expect(buf(buffers, 'b.js')?.content).toContain('Hello');
    expect(await workspace.readFile('p', 'b.recovered.js')).toBe('b edits');
  });
});

describe('loading an unchanged file again', () => {
  it("skips the reread when the file's size and time haven't changed", async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    const read = jest.spyOn(workspace, 'readFile');
    await buffers.getState().load('p', 'index.js');
    expect(read).not.toHaveBeenCalled();
    await workspace.writeFile('p', 'index.js', 'changed');
    expect((await buffers.getState().load('p', 'index.js')).content).toBe('changed');
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
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

describe('replace', () => {
  it('writes through, resets the buffer and cancels a pending autosave', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'typed');
    await buffers.getState().replace('p', 'index.js', 'from shell');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();
    expect(await workspace.readFile('p', 'index.js')).toBe('from shell');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'from shell', saved: 'from shell' });
  });
});

describe('closing a tab while the editor still holds keystrokes', () => {
  it('saves a late edit that arrives just after drop', async () => {
    const { buffers, workspace } = await setup();
    const { content } = await buffers.getState().load('p', 'index.js');
    // Tab closed: saved (nothing pending yet) and dropped.
    await buffers.getState().save('p', 'index.js');
    buffers.getState().drop('p', 'index.js');
    // The editor's debounced change lands afterwards.
    buffers.getState().edit('p', 'index.js', `${content}// last words`);
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await settle();
    expect(await workspace.readFile('p', 'index.js')).toBe(`${content}// last words`);
  });

  it('ignores edits long after the drop, and for files deleted since', async () => {
    let clock = 0;
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    await workspace.createProject('p', 'node-hello');
    const buffers = createBuffersStore(workspace, AUTOSAVE_MS, {}, () => clock);
    await buffers.getState().load('p', 'index.js');
    await buffers.getState().load('p', 'tide.json');
    buffers.getState().drop('p', 'index.js');
    buffers.getState().drop('p', 'tide.json');
    buffers.getState().removePath('p', 'tide.json');
    buffers.getState().edit('p', 'tide.json', 'resurrected?');
    expect(buf(buffers, 'tide.json')).toBeUndefined();
    clock += DROP_GRACE_MS + 1;
    buffers.getState().edit('p', 'index.js', 'too late');
    expect(buf(buffers, 'index.js')).toBeUndefined();
  });
});

describe('files deleted on disk', () => {
  it('forgets a clean buffer and reports it gone', async () => {
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    await workspace.createProject('p', 'node-hello');
    const gone = jest.fn();
    const buffers = createBuffersStore(workspace, AUTOSAVE_MS, { gone });
    await buffers.getState().load('p', 'index.js');
    await workspace.deleteEntry('p', 'index.js');
    await buffers.getState().reloadProject('p');
    expect(buf(buffers, 'index.js')).toBeUndefined();
    expect(gone).toHaveBeenCalledWith('p', 'index.js');
    // A late keystroke doesn't bring the file back.
    buffers.getState().edit('p', 'index.js', 'x');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();
    expect(await workspace.stat('p', 'index.js')).toBeNull();
  });

  it('load fails for a clean buffer whose file is gone, instead of showing the old text', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    await workspace.deleteEntry('p', 'index.js');
    await expect(buffers.getState().load('p', 'index.js')).rejects.toThrow();
  });

  it('keeps unsaved edits but never autosaves them back into a deleted file', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'mine');
    await workspace.deleteEntry('p', 'index.js');
    await buffers.getState().reload('p', 'index.js');
    expect(buf(buffers, 'index.js')).toMatchObject({ content: 'mine', deleted: true });
    buffers.getState().edit('p', 'index.js', 'mine, more');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();
    await buffers.getState().flushAll();
    await buffers.getState().save('p', 'index.js');
    expect(await workspace.stat('p', 'index.js')).toBeNull();
    // Only when the user asks.
    await buffers.getState().save('p', 'index.js', { recreate: true });
    expect(await workspace.readFile('p', 'index.js')).toBe('mine, more');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'mine, more', saved: 'mine, more' });
  });

  it('clears the mark when the same file comes back, keeping the edits unsaved', async () => {
    const { buffers, workspace } = await setup();
    const { content } = await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'mine');
    await workspace.deleteEntry('p', 'index.js');
    await buffers.getState().reload('p', 'index.js');
    // e.g. git checkout the other way.
    await workspace.createFile('p', '', 'index.js', content);
    await buffers.getState().reload('p', 'index.js');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'mine', saved: content });
  });

  it("never autosaves a deleted file's edits over a new file at its path; they go to a recovered copy", async () => {
    const recovered = jest.fn();
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    await workspace.createProject('p', 'node-hello');
    const buffers = createBuffersStore(workspace, AUTOSAVE_MS, { recovered });
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'old edits');
    await workspace.deleteEntry('p', 'index.js');
    await buffers.getState().reload('p', 'index.js');
    await workspace.createFile('p', '', 'index.js', 'a new file');
    // Opening the tab again (load) notices, without a false "Deleted on disk".
    const loaded = await buffers.getState().load('p', 'index.js');
    expect(loaded).toEqual({ content: 'a new file', saved: 'a new file', recoveredTo: 'index.recovered.js' });
    expect(await workspace.readFile('p', 'index.recovered.js')).toBe('old edits');
    expect(recovered).toHaveBeenCalledWith('p', 'index.js', 'index.recovered.js');
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await settle();
    await buffers.getState().reloadProject('p');
    await buffers.getState().flushAll();
    expect(await workspace.readFile('p', 'index.js')).toBe('a new file');
    buffers.getState().clearRecovered('p', 'index.js');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'a new file', saved: 'a new file' });
  });

  it('marks a buffer deleted when an autosave finds its file removed, and stops blocking flushes', async () => {
    const { buffers, workspace, fs } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'typed');
    // Removed behind the app's back, e.g. by a remote sync.
    fs.files.delete('projects/p/index.js');
    await expect(buffers.getState().save('p', 'index.js')).resolves.toBeUndefined();
    expect(buf(buffers, 'index.js')).toMatchObject({ content: 'typed', deleted: true });
    await expect(buffers.getState().flushProject('p')).resolves.toBeUndefined();
    expect(await workspace.stat('p', 'index.js')).toBeNull();
  });

  it("keeps the editor's last keystrokes: they're flushed in before the buffer is treated as gone", async () => {
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    await workspace.createProject('p', 'node-hello');
    const gone = jest.fn();
    let buffers!: ReturnType<typeof createBuffersStore>;
    const beforeGone = jest.fn(async () => buffers.getState().edit('p', 'index.js', 'typed just now'));
    buffers = createBuffersStore(workspace, AUTOSAVE_MS, { gone, beforeGone });
    await buffers.getState().load('p', 'index.js');
    await workspace.deleteEntry('p', 'index.js');
    await buffers.getState().reload('p', 'index.js');
    expect(beforeGone).toHaveBeenCalled();
    expect(gone).not.toHaveBeenCalled();
    expect(buf(buffers, 'index.js')).toMatchObject({ content: 'typed just now', deleted: true });
  });

  it("doesn't treat a file mid-rename as deleted", async () => {
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    await workspace.createProject('p', 'node-hello');
    const gone = jest.fn();
    const buffers = createBuffersStore(workspace, AUTOSAVE_MS, { gone });
    await buffers.getState().load('p', 'index.js');
    const release = buffers.getState().hold('p', 'index.js');
    await workspace.renameEntry('p', 'index.js', 'main.js');
    await buffers.getState().reload('p', 'index.js');
    expect(gone).not.toHaveBeenCalled();
    buffers.getState().renamePath('p', 'index.js', 'main.js');
    release();
    expect(buf(buffers, 'main.js')).toBeDefined();
  });

  it('discard forgets a buffer with unsaved edits', async () => {
    const { buffers } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().edit('p', 'index.js', 'unwanted');
    buffers.getState().discard('p', 'index.js');
    expect(buf(buffers, 'index.js')).toBeUndefined();
  });

  it('leaves the buffer alone when the file is only unreadable for a moment', async () => {
    const { buffers, workspace } = await setup();
    const { content } = await buffers.getState().load('p', 'index.js');
    jest.spyOn(workspace, 'stat').mockRejectedValueOnce(new Error('EIO'));
    await buffers.getState().reload('p', 'index.js');
    expect(buf(buffers, 'index.js')).toEqual({ content, saved: content });
  });
});

describe('a slow reload overtaken by a write (L4)', () => {
  // Holds the next readFile of the workspace until released, returning what
  // was on disk when the read started.
  const holdNextRead = (workspace: Awaited<ReturnType<typeof setup>>['workspace']) => {
    const real = workspace.readFile.bind(workspace);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const spy = jest.spyOn(workspace, 'readFile').mockImplementationOnce(async (project, path) => {
      const old = await real(project, path);
      await gate;
      return old;
    });
    return { release, restore: () => spy.mockRestore() };
  };

  it('discards a reload read that started before a replace', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    await workspace.writeFile('p', 'index.js', 'old on disk');
    const held = holdNextRead(workspace);
    const reloading = buffers.getState().reload('p', 'index.js');
    await settle();
    await buffers.getState().replace('p', 'index.js', 'new from shell');
    held.release();
    await reloading;
    held.restore();
    expect(buf(buffers, 'index.js')).toEqual({ content: 'new from shell', saved: 'new from shell' });
    // The next edit doesn't write the old text back.
    buffers.getState().edit('p', 'index.js', 'new from shell!');
    await buffers.getState().save('p', 'index.js');
    expect(await workspace.readFile('p', 'index.js')).toBe('new from shell!');
  });

  it('discards a reload read that started before a save', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    await workspace.writeFile('p', 'index.js', 'old on disk');
    const held = holdNextRead(workspace);
    const reloading = buffers.getState().reload('p', 'index.js');
    await settle();
    buffers.getState().edit('p', 'index.js', 'typed');
    await buffers.getState().save('p', 'index.js');
    held.release();
    await reloading;
    held.restore();
    expect(buf(buffers, 'index.js')).toEqual({ content: 'typed', saved: 'typed' });
    expect(await workspace.readFile('p', 'index.js')).toBe('typed');
  });

  it('still applies a reload nothing overtook', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    await workspace.writeFile('p', 'index.js', 'pulled');
    const held = holdNextRead(workspace);
    const reloading = buffers.getState().reload('p', 'index.js');
    await settle();
    held.release();
    await reloading;
    held.restore();
    expect(buf(buffers, 'index.js')).toEqual({ content: 'pulled', saved: 'pulled' });
  });
});

describe('format on save', () => {
  const trim = (_p: string, _path: string, content: string, reason: string) =>
    Promise.resolve(reason === 'auto' ? content.replace(/ +$/gm, '') + '|auto' : content.replace(/ +$/gm, ''));

  it('writes the formatted text, and the buffer takes it when nothing was typed meanwhile', async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().setSaveFormatter(trim);
    buffers.getState().edit('p', 'index.js', 'a  \nb');
    await buffers.getState().save('p', 'index.js');
    expect(await workspace.readFile('p', 'index.js')).toBe('a\nb');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'a\nb', saved: 'a\nb' });
  });

  it("tells autosave apart from explicit saves, and keeps what's typed during the write", async () => {
    const { buffers, workspace } = await setup();
    await buffers.getState().load('p', 'index.js');
    buffers.getState().setSaveFormatter(trim);
    buffers.getState().edit('p', 'index.js', 'x ');
    jest.advanceTimersByTime(AUTOSAVE_MS);
    // Typed while the formatter runs.
    buffers.getState().edit('p', 'index.js', 'x y');
    await settle();
    await settle();
    expect(await workspace.readFile('p', 'index.js')).toBe('x|auto');
    expect(buf(buffers, 'index.js')).toEqual({ content: 'x y', saved: 'x|auto' });
  });

  it('formats an explicit save of an unchanged file, but not a flush', async () => {
    const { buffers, workspace } = await setup();
    await workspace.writeFile('p', 'index.js', 'z  ');
    await buffers.getState().load('p', 'index.js');
    buffers.getState().setSaveFormatter(trim);
    await buffers.getState().flushProject('p');
    expect(await workspace.readFile('p', 'index.js')).toBe('z  ');
    await buffers.getState().save('p', 'index.js');
    expect(await workspace.readFile('p', 'index.js')).toBe('z');
    expect(isDirty(buf(buffers, 'index.js'))).toBe(false);
  });

  it('saves as typed when the formatter fails', async () => {
    const { buffers, workspace } = await setup();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await buffers.getState().load('p', 'index.js');
    buffers.getState().setSaveFormatter(() => Promise.reject(new Error('nope')));
    buffers.getState().edit('p', 'index.js', 'q  ');
    await buffers.getState().save('p', 'index.js');
    expect(await workspace.readFile('p', 'index.js')).toBe('q  ');
    warn.mockRestore();
  });
});
