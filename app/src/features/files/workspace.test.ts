import { createMemoryFs } from './memoryFs';
import { RUN_CONFIG_FILE, templates } from './templates';
import { WorkspaceError, createWorkspace, normalizePath, validateName } from './workspace';

function setup() {
  const fs = createMemoryFs();
  return { fs, ws: createWorkspace(fs) };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'WorkspaceError', code });
}

describe('validateName', () => {
  it('trims and accepts normal names, including dotfiles', () => {
    expect(validateName('  app.js ')).toBe('app.js');
    expect(validateName('.gitignore')).toBe('.gitignore');
  });

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'tab\there', 'x'.repeat(129)])('rejects %j', (name) => {
    expect(() => validateName(name)).toThrow(WorkspaceError);
  });
});

describe('normalizePath', () => {
  it('drops empty and dot segments', () => {
    expect(normalizePath('/src//./app.js')).toBe('src/app.js');
    expect(normalizePath('')).toBe('');
  });

  it('rejects paths that leave the project', () => {
    expect(() => normalizePath('src/../../etc')).toThrow('leaves the project');
  });
});

describe('projects', () => {
  it('starts with no projects', async () => {
    const { ws } = setup();
    await expect(ws.listProjects()).resolves.toEqual([]);
  });

  it.each(templates.map((t) => [t.id, t] as const))('creates a project from %s', async (_id, template) => {
    const { ws } = setup();
    await ws.createProject('demo', template.id);
    const tree = await ws.readTree('demo');
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual([...Object.keys(template.files), RUN_CONFIG_FILE].sort());
    await expect(ws.readRunConfig('demo')).resolves.toEqual(template.run);
  });

  it('lists projects in natural order', async () => {
    const { ws } = setup();
    for (const name of ['b', 'a10', 'a2']) await ws.createProject(name, 'node-hello');
    await expect(ws.listProjects()).resolves.toEqual(['a2', 'a10', 'b']);
  });

  it('refuses duplicates and unknown templates', async () => {
    const { ws } = setup();
    await ws.createProject('demo', 'node-hello');
    await expectCode(ws.createProject('demo', 'python-hello'), 'exists');
    await expectCode(ws.createProject('other', 'nope'), 'unknown-template');
  });

  it('renames and deletes projects', async () => {
    const { ws } = setup();
    await ws.createProject('demo', 'node-hello');
    await ws.createProject('taken', 'node-hello');
    await expectCode(ws.renameProject('demo', 'taken'), 'exists');
    await expect(ws.renameProject('demo', 'renamed')).resolves.toBe('renamed');
    await expect(ws.readFile('renamed', 'index.js')).resolves.toContain('Hello');
    await ws.deleteProject('renamed');
    await expect(ws.listProjects()).resolves.toEqual(['taken']);
    await expectCode(ws.deleteProject('renamed'), 'not-found');
  });
});

describe('files and folders', () => {
  async function project() {
    const ctx = setup();
    await ctx.ws.createProject('demo', 'node-hello');
    return ctx;
  }

  it('creates nested folders and files and returns a sorted tree', async () => {
    const { ws } = await project();
    await ws.createFolder('demo', '', 'src');
    await ws.createFolder('demo', 'src', 'lib');
    await expect(ws.createFile('demo', 'src/lib', 'util.js', 'x')).resolves.toBe('src/lib/util.js');
    await ws.createFile('demo', '', 'README.md');

    const tree = await ws.readTree('demo');
    // Folders first, then files, each alphabetical.
    expect(tree.map((n) => n.name)).toEqual(['src', 'index.js', 'README.md', 'tide.json']);
    expect(tree[0].children?.[0]).toMatchObject({ name: 'lib', path: 'src/lib', kind: 'dir' });
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({ path: 'src/lib/util.js', kind: 'file' });
  });

  it('shows node_modules without listing its contents', async () => {
    const { ws, fs } = await project();
    await fs.writeFile('projects/demo/node_modules/express/index.js', '');
    const tree = await ws.readTree('demo');
    expect(tree.find((n) => n.name === 'node_modules')).toEqual({
      name: 'node_modules',
      path: 'node_modules',
      kind: 'dir',
      children: [],
      unlisted: true,
    });
  });

  it('keeps empty folders in the tree', async () => {
    const { ws } = await project();
    await ws.createFolder('demo', '', 'empty');
    const tree = await ws.readTree('demo');
    expect(tree[0]).toEqual({ name: 'empty', path: 'empty', kind: 'dir', children: [] });
  });

  it('refuses to create over an existing entry or inside a missing folder', async () => {
    const { ws } = await project();
    await expectCode(ws.createFile('demo', '', 'index.js'), 'exists');
    await expectCode(ws.createFolder('demo', '', 'index.js'), 'exists');
    await expectCode(ws.createFile('demo', 'missing', 'a.js'), 'not-found');
    await expectCode(ws.createFile('demo', 'index.js', 'a.js'), 'not-found');
  });

  it('renames a folder with its contents', async () => {
    const { ws } = await project();
    await ws.createFolder('demo', '', 'src');
    await ws.createFile('demo', 'src', 'a.js', 'a');
    await expect(ws.renameEntry('demo', 'src', 'lib')).resolves.toBe('lib');
    await expect(ws.readFile('demo', 'lib/a.js')).resolves.toBe('a');
    await expectCode(ws.readFile('demo', 'src/a.js'), 'not-found');
  });

  it('refuses renames onto existing names and of the project root', async () => {
    const { ws } = await project();
    await ws.createFile('demo', '', 'b.js');
    await expectCode(ws.renameEntry('demo', 'b.js', 'index.js'), 'exists');
    await expectCode(ws.renameEntry('demo', '', 'x'), 'invalid-path');
    await expect(ws.renameEntry('demo', 'b.js', 'b.js')).resolves.toBe('b.js');
  });

  it('deletes files and folders recursively', async () => {
    const { ws } = await project();
    await ws.createFolder('demo', '', 'src');
    await ws.createFile('demo', 'src', 'a.js');
    await ws.deleteEntry('demo', 'src');
    await ws.deleteEntry('demo', 'index.js');
    expect((await ws.readTree('demo')).map((n) => n.name)).toEqual(['tide.json']);
    await expectCode(ws.deleteEntry('demo', ''), 'invalid-path');
    await expectCode(ws.deleteEntry('demo', 'gone.js'), 'not-found');
  });

  it('reads and writes existing files only', async () => {
    const { ws } = await project();
    await ws.writeFile('demo', 'index.js', 'console.log(1);\n');
    await expect(ws.readFile('demo', 'index.js')).resolves.toBe('console.log(1);\n');
    await expectCode(ws.writeFile('demo', 'new.js', ''), 'not-found');
  });

  it('keeps every operation inside the project folder', async () => {
    const { ws, fs } = await project();
    await ws.createProject('other', 'node-hello');
    await expectCode(ws.readFile('demo', '../other/index.js'), 'invalid-path');
    await expectCode(ws.deleteEntry('demo', '../other'), 'invalid-path');
    await expectCode(ws.createFile('demo', '..', 'x.js'), 'invalid-path');
    await expectCode(ws.readTree('../demo'), 'invalid-name');
    expect(fs.dirs.has('projects/other')).toBe(true);
  });
});

describe('stat, list, move and copy', () => {
  async function project() {
    const ctx = setup();
    await ctx.ws.createProject('demo', 'node-hello');
    await ctx.ws.createFolder('demo', '', 'src');
    await ctx.ws.createFile('demo', 'src', 'a.js', 'a');
    return ctx;
  }

  it('stats and lists entries', async () => {
    const { ws } = await project();
    await expect(ws.stat('demo', 'src')).resolves.toBe('dir');
    await expect(ws.stat('demo', 'src/a.js')).resolves.toBe('file');
    await expect(ws.stat('demo', 'nope')).resolves.toBeNull();
    await expect(ws.list('demo', '')).resolves.toEqual([
      { name: 'src', kind: 'dir' },
      { name: 'index.js', kind: 'file' },
      { name: 'tide.json', kind: 'file' },
    ]);
    await expectCode(ws.list('demo', 'index.js'), 'not-found');
  });

  it('moves a file into another folder and renames within one', async () => {
    const { ws, fs } = await project();
    await ws.createFolder('demo', '', 'lib');
    await expect(ws.moveEntry('demo', 'src/a.js', 'lib/b.js')).resolves.toBe('lib/b.js');
    expect(fs.files.get('projects/demo/lib/b.js')).toBe('a');
    expect(fs.files.has('projects/demo/src/a.js')).toBe(false);
    await ws.moveEntry('demo', 'lib/b.js', 'lib/c.js');
    await expect(ws.readFile('demo', 'lib/c.js')).resolves.toBe('a');
  });

  it('moves and copies whole folders', async () => {
    const { ws, fs } = await project();
    await ws.createFolder('demo', 'src', 'deep');
    await ws.createFile('demo', 'src/deep', 'd.js', 'd');
    await ws.createFolder('demo', '', 'out');
    await ws.copyEntry('demo', 'src', 'out/src');
    expect(fs.files.get('projects/demo/out/src/deep/d.js')).toBe('d');
    expect(fs.files.get('projects/demo/src/a.js')).toBe('a');
    await ws.moveEntry('demo', 'src', 'out/moved');
    expect(fs.files.get('projects/demo/out/moved/a.js')).toBe('a');
    expect(fs.dirs.has('projects/demo/src')).toBe(false);
  });

  it('refuses bad moves and copies', async () => {
    const { ws } = await project();
    await expectCode(ws.moveEntry('demo', 'src', 'src/inner'), 'invalid-path');
    await expectCode(ws.copyEntry('demo', 'src', 'src'), 'invalid-path');
    await expectCode(ws.moveEntry('demo', 'src/a.js', 'index.js'), 'exists');
    await expectCode(ws.copyEntry('demo', 'src/a.js', 'missing/a.js'), 'not-found');
    await expectCode(ws.moveEntry('demo', 'ghost.js', 'x.js'), 'not-found');
    await expectCode(ws.moveEntry('demo', '', 'x'), 'invalid-path');
  });
});
