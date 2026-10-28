import { DirEntry, EntryKind, FsAdapter, basename, dirname, joinPath } from './fs';
import { RUN_CONFIG_FILE, RunConfig, findTemplate } from './templates';

export const PROJECTS_DIR = 'projects';

export type WorkspaceErrorCode = 'invalid-name' | 'invalid-path' | 'exists' | 'not-found' | 'unknown-template';

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface TreeNode {
  name: string;
  // Relative to the project root, e.g. "src/app.js".
  path: string;
  kind: EntryKind;
  children?: TreeNode[];
  // True for folders like node_modules whose contents are not listed.
  unlisted?: boolean;
}

// Installed dependencies can be thousands of files; the tree shows the folder but not its contents.
const UNLISTED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.pylibs']);

const MAX_NAME = 128;

export function validateName(name: string, what = 'Name'): string {
  const trimmed = name.trim();
  if (!trimmed) throw new WorkspaceError('invalid-name', `${what} can't be empty`);
  if (trimmed.length > MAX_NAME) throw new WorkspaceError('invalid-name', `${what} is longer than ${MAX_NAME} characters`);
  if (trimmed === '.' || trimmed === '..') throw new WorkspaceError('invalid-name', `${what} can't be "${trimmed}"`);
  if (/[/\\:\u0000-\u001f]/.test(trimmed)) {
    throw new WorkspaceError('invalid-name', `${what} can't contain / \\ : or control characters`);
  }
  return trimmed;
}

// Normalizes a project-relative path and rejects anything that would leave the project.
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new WorkspaceError('invalid-path', `Path "${path}" leaves the project`);
    parts.push(validateName(part, 'Path segment'));
  }
  return parts.join('/');
}

function sortEntries<T extends { name: string; kind: EntryKind }>(entries: T[]): T[] {
  return entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'dir' ? -1 : 1,
  );
}

export function createWorkspace(fs: FsAdapter) {
  const projectRoot = (project: string) => joinPath(PROJECTS_DIR, validateName(project, 'Project name'));
  const abs = (project: string, path: string) => joinPath(projectRoot(project), normalizePath(path));

  async function requireKind(path: string, kind?: EntryKind) {
    const found = await fs.stat(path);
    if (!found || (kind && found !== kind)) throw new WorkspaceError('not-found', `"${path}" doesn't exist`);
    return found;
  }

  async function requireFree(path: string) {
    if (await fs.stat(path)) throw new WorkspaceError('exists', `"${basename(path)}" already exists`);
  }

  async function readTree(project: string, rel = ''): Promise<TreeNode[]> {
    const entries = sortEntries(await fs.readDir(abs(project, rel)));
    return Promise.all(
      entries.map(async (e) => {
        const path = joinPath(rel, e.name);
        if (e.kind !== 'dir') return { name: e.name, path, kind: e.kind };
        if (UNLISTED_DIRS.has(e.name)) return { name: e.name, path, kind: e.kind, children: [], unlisted: true };
        return { name: e.name, path, kind: e.kind, children: await readTree(project, path) };
      }),
    );
  }

  // Recursive copy used by cp and by moves across folders (rename only works within one).
  async function copyTree(from: string, to: string) {
    if ((await fs.stat(from)) === 'file') {
      await fs.copyFile(from, to);
      return;
    }
    await fs.mkdir(to);
    for (const e of await fs.readDir(from)) {
      await copyTree(joinPath(from, e.name), joinPath(to, e.name));
    }
  }

  async function checkRelocation(project: string, from: string, to: string) {
    if (!from) throw new WorkspaceError('invalid-path', "The project root can't be moved or copied");
    if (!to) throw new WorkspaceError('invalid-path', 'Missing destination');
    await requireKind(abs(project, from));
    if (to === from || to.startsWith(`${from}/`)) {
      throw new WorkspaceError('invalid-path', `Can't put "${from}" inside itself`);
    }
    await requireKind(abs(project, dirname(to)), 'dir');
    await requireFree(abs(project, to));
  }

  return {
    async stat(project: string, path: string): Promise<EntryKind | null> {
      return fs.stat(abs(project, path));
    },

    async list(project: string, path: string): Promise<DirEntry[]> {
      await requireKind(abs(project, path), 'dir');
      return sortEntries(await fs.readDir(abs(project, path)));
    },

    // `to` is the full destination path, not a folder to move into.
    async moveEntry(project: string, path: string, to: string): Promise<string> {
      const from = normalizePath(path);
      const target = normalizePath(to);
      await checkRelocation(project, from, target);
      if (dirname(from) === dirname(target)) {
        await fs.rename(abs(project, from), basename(target));
      } else {
        await copyTree(abs(project, from), abs(project, target));
        await fs.remove(abs(project, from));
      }
      return target;
    },

    async copyEntry(project: string, path: string, to: string): Promise<string> {
      const from = normalizePath(path);
      const target = normalizePath(to);
      await checkRelocation(project, from, target);
      await copyTree(abs(project, from), abs(project, target));
      return target;
    },

    async listProjects(): Promise<string[]> {
      if ((await fs.stat(PROJECTS_DIR)) !== 'dir') return [];
      const entries = await fs.readDir(PROJECTS_DIR);
      return sortEntries(entries.filter((e) => e.kind === 'dir')).map((e) => e.name);
    },

    async createProject(name: string, templateId: string): Promise<string> {
      const template = findTemplate(templateId);
      if (!template) throw new WorkspaceError('unknown-template', `Unknown template "${templateId}"`);
      const project = validateName(name, 'Project name');
      const root = projectRoot(project);
      await requireFree(root);
      await fs.mkdir(root);
      const files = { ...template.files, [RUN_CONFIG_FILE]: `${JSON.stringify(template.run, null, 2)}\n` };
      for (const [path, content] of Object.entries(files)) {
        await fs.writeFile(joinPath(root, path), content);
      }
      return project;
    },

    async renameProject(name: string, newName: string): Promise<string> {
      const target = validateName(newName, 'Project name');
      await requireKind(projectRoot(name), 'dir');
      if (target === name) return target;
      await requireFree(projectRoot(target));
      await fs.rename(projectRoot(name), target);
      return target;
    },

    async deleteProject(name: string): Promise<void> {
      await requireKind(projectRoot(name), 'dir');
      await fs.remove(projectRoot(name));
    },

    readTree: (project: string) => readTree(project),

    async readRunConfig(project: string): Promise<RunConfig | null> {
      const path = abs(project, RUN_CONFIG_FILE);
      if ((await fs.stat(path)) !== 'file') return null;
      try {
        return JSON.parse(await fs.readFile(path)) as RunConfig;
      } catch {
        return null;
      }
    },

    async createFile(project: string, parent: string, name: string, content = ''): Promise<string> {
      const path = joinPath(normalizePath(parent), validateName(name, 'File name'));
      await requireKind(abs(project, parent), 'dir');
      await requireFree(abs(project, path));
      await fs.writeFile(abs(project, path), content);
      return path;
    },

    async createFolder(project: string, parent: string, name: string): Promise<string> {
      const path = joinPath(normalizePath(parent), validateName(name, 'Folder name'));
      await requireKind(abs(project, parent), 'dir');
      await requireFree(abs(project, path));
      await fs.mkdir(abs(project, path));
      return path;
    },

    async renameEntry(project: string, path: string, newName: string): Promise<string> {
      const from = normalizePath(path);
      if (!from) throw new WorkspaceError('invalid-path', 'Rename the project from the projects list');
      const to = joinPath(dirname(from), validateName(newName));
      await requireKind(abs(project, from));
      if (to === from) return to;
      await requireFree(abs(project, to));
      await fs.rename(abs(project, from), basename(to));
      return to;
    },

    async deleteEntry(project: string, path: string): Promise<void> {
      const target = normalizePath(path);
      if (!target) throw new WorkspaceError('invalid-path', 'Delete the project from the projects list');
      await requireKind(abs(project, target));
      await fs.remove(abs(project, target));
    },

    // Every file path in the project, skipping the folders the tree doesn't list.
    async listFiles(project: string): Promise<string[]> {
      const out: string[] = [];
      const walk = async (rel: string) => {
        for (const e of await fs.readDir(abs(project, rel))) {
          const path = joinPath(rel, e.name);
          if (e.kind === 'file') out.push(path);
          else if (!UNLISTED_DIRS.has(e.name)) await walk(path);
        }
      };
      await walk('');
      return out;
    },

    async readBase64(project: string, path: string): Promise<string> {
      return fs.readBase64(abs(project, path));
    },

    // Unlike writeFile, creates the file and its folders if needed.
    async writeBase64(project: string, path: string, data: string): Promise<void> {
      if (!normalizePath(path)) throw new WorkspaceError('invalid-path', 'Missing file path');
      await fs.writeBase64(abs(project, path), data);
    },

    // Deletes a file if it exists; used when the other side of a sync already removed it.
    async removeIfPresent(project: string, path: string): Promise<void> {
      const target = abs(project, path);
      if (normalizePath(path) && (await fs.stat(target))) await fs.remove(target);
    },

    async readFile(project: string, path: string): Promise<string> {
      await requireKind(abs(project, path), 'file');
      return fs.readFile(abs(project, path));
    },

    async writeFile(project: string, path: string, content: string): Promise<void> {
      await requireKind(abs(project, path), 'file');
      await fs.writeFile(abs(project, path), content);
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
